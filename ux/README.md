# UX: personas and stories

What a person does with this app, written so an agent can do it too. Fettle's
explore job runs these stories in a bay against the fixtures; plans add a story
per ticket.

- `personas.md`: the fixture people. Each is a fixture account with a ready
  session; agents never use a person's own account.
- `stories/NN-slug.md`: one story per file, in four lines:

  > As a [role] on [device], I want [goal] so that [outcome].
  > Starting from [state].
  > Done when [signal].
  > I expect [norms].

  The number is priority. The first ten are the regression set, re-run on
  every merge to staging.

A PR that changes a flow updates its story in the same PR.
