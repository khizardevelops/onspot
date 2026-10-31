# bugs

User-reported bugs to fix. Agent-tracked defects with root causes live in
`.agents/handoff/references/bugs.md`.

- the start speaking button should not work unless the user has added a an llm provider api key. it should tell the user to add one first.
- speaking in the wrong language dosnt penalise or show errors to the user instead it just says "clean take" when no errors are made in the speech even though the response was in the wrong language
- the padding around the attempt cards should as minimal as possible, to increase screen real estate but to also give the feeling that the cards are part of the parent
- if a sesson has started in language_a then the globally selected language would not override the locally selected language per session. the "im studying" language selection in the settings only mean that that language would be selected by defualt for each new session started and therefore its language data would have been preloaded and seemless. if i go back to a previous session where i was studying french and my globally selecting study language is japaness then it would still mean that that session would be using french. once a session has started in a particular language then it cannot be changed.
-