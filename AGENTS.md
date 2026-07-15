# Bastion Development Requirements

These requirements apply to the entire repository.

## Generalize from examples

- Treat examples in requirements, prompts, Skills, tests, and bug reports as
  illustrations of a semantic rule, not as an exhaustive specification.
- Implement the underlying invariant or equivalence class. Do not branch on,
  keyword-match, or otherwise special-case literal wording, names, IDs, dates,
  teams, players, or ranges copied from an example.
- Prompt and Skill guidance must state the general decision boundary before any
  example. Mark examples as non-exhaustive when they could be mistaken for a
  closed list.
- Tests must primarily assert generalized behavior. Add representative variants
  or counterexamples when a literal fixture could allow an implementation to
  pass by recognizing only that fixture.
- Exact-text assertions are appropriate only when the text itself is a public
  contract. They must not substitute for behavioral coverage of the rule the
  text describes.
- During review, reject changes that satisfy named examples while failing
  semantically equivalent inputs. Explicitly check for hard-coded sample terms
  and narrow heuristics.

