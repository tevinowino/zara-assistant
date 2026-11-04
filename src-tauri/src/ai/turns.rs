//! Which question the assistant is answering.
//!
//! A question can take a long time (a search, a look at the screen, a model that
//! thinks), and the user may start another chat, or ask something else, before it
//! is done. Without this, the first question would go on, report into the second's
//! panel, and have its answer taken for the second's. So only the newest question
//! counts: starting one, or stopping, makes every earlier one "replaced", and a
//! replaced question stops reporting and is dropped, which ends its request.

use std::sync::Arc;
use tokio::sync::watch;

/// The count of questions started or stopped so far.
#[derive(Clone)]
pub struct Turns(Arc<watch::Sender<u64>>);

impl Turns {
    pub fn new() -> Self {
        Self(Arc::new(watch::channel(0).0))
    }

    /// A new question is starting. Any question still being answered is replaced.
    pub fn begin(&self) -> Turn {
        let mut id = 0;
        self.0.send_modify(|count| {
            *count += 1;
            id = *count;
        });
        Turn { turns: self.clone(), id }
    }

    /// The question being answered, if any, is stopped.
    pub fn stop(&self) {
        self.0.send_modify(|count| *count += 1);
    }
}

/// One question's place in line.
#[derive(Clone)]
pub struct Turn {
    turns: Turns,
    id: u64,
}

impl Turn {
    /// Nothing has started or stopped since this question began.
    pub fn is_current(&self) -> bool {
        *self.turns.0.borrow() == self.id
    }

    /// Resolves when this question is replaced or stopped.
    pub async fn replaced(&self) {
        let mut changes = self.turns.0.subscribe();
        let _ = changes.wait_for(|count| *count != self.id).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn a_question_is_current_until_something_else_starts() {
        let turns = Turns::new();
        let first = turns.begin();
        assert!(first.is_current());

        let second = turns.begin();

        assert!(!first.is_current());
        assert!(second.is_current());
    }

    #[test]
    fn stopping_replaces_the_question_being_answered() {
        let turns = Turns::new();
        let question = turns.begin();

        turns.stop();

        assert!(!question.is_current());
    }

    #[test]
    fn a_question_that_began_after_a_stop_is_current() {
        let turns = Turns::new();
        turns.begin();
        turns.stop();

        assert!(turns.begin().is_current());
    }

    #[test]
    fn copies_of_a_question_agree_about_whether_it_is_current() {
        let turns = Turns::new();
        let question = turns.begin();
        let copy = question.clone();

        turns.stop();

        assert!(!question.is_current() && !copy.is_current());
    }

    #[tokio::test]
    async fn a_replaced_question_is_told_so() {
        let turns = Turns::new();
        let question = turns.begin();

        turns.begin();

        tokio::time::timeout(Duration::from_secs(1), question.replaced())
            .await
            .expect("a replaced question is told at once");
    }

    #[tokio::test]
    async fn a_question_that_is_waiting_is_told_when_it_is_stopped() {
        let turns = Turns::new();
        let question = turns.begin();
        let waiting = tokio::spawn({
            let question = question.clone();
            async move { question.replaced().await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!waiting.is_finished(), "nothing has replaced the question yet");

        turns.stop();

        tokio::time::timeout(Duration::from_secs(1), waiting)
            .await
            .expect("told when stopped")
            .unwrap();
    }

    #[tokio::test]
    async fn the_current_question_is_never_told_it_was_replaced() {
        let turns = Turns::new();
        let question = turns.begin();

        let told = tokio::time::timeout(Duration::from_millis(50), question.replaced()).await;

        assert!(told.is_err());
    }
}
