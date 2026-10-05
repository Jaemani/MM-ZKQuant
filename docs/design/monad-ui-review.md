# Monad compact workspace

The user selected image `exec-62044902-d542-4ada-8c59-8131e01fbafe.png` after rejecting the initial light card design. The current implementation replaces that approach with a dark split workspace and a mobile list-to-detail flow.

- Desktop: narrow icon navigation, compact strategy rows, independent comparison selection, live strategy inspector with conditions and investment form.
- Mobile/tablet: full-width list; row opens the existing detailed performance and investment page. Mobile bottom navigation, labeled figures, visible risk and status, and an investment shortcut support one-handed use.
- Shared screens: matching dark tokens, tables, inputs, dialogs and charts across investor and manager flows.
- Existing API, encrypted portfolio retrieval and transaction behavior preserved. The original workspace's uncommitted changes were excluded through a separate worktree.

Visual source, browser evidence, fixes and test results: [design QA](../../design-qa.md). Current images use the `split-*` prefix; older screenshots document the prior iteration only.

Production: https://mm-zkquant.vercel.app

Source branch: `design/monad-ui`.
