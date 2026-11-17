# Migrating from a BC Parks Account to BCSC

```mermaid
flowchart TD
  A[User starts BCSC sign-in] --> B[PreSignUp finds a live BC Parks email claim]
  B --> C[Create migrateHold and mark emailClaim migration pending]
  C --> D[Refuse BCSC signup with the migration ID]
  D --> E[Frontend displays the migration prompt]
  E --> F{Continue or cancel?}
  F -- Cancel --> G[Return to regular login; no migration is confirmed]
  G --> A
  F -- Continue --> H[Sign in with email and password to BC Parks]
  H --> I[PostAuthentication copies pending state to Cognito custom attributes]
  I --> J[Frontend displays the migration banner]
  J --> K[User requests an email confirmation link]
  K --> L[Authenticated API checks the BC Parks username matches the hold]
  L --> M[Store a hash of a random one-time token until the hold expires]
  M --> N[Send confirmation link to the BC Parks account email]
  N --> O[User opens the link]
  O --> P[Public endpoint validates token and conditionally confirms the hold]
  P --> Q[Clear migration-pending state in emailClaim and Cognito]
  Q --> R[Frontend signs the BC Parks user out]
  R --> S[User signs in with BCSC again]
  S --> T[PreSignUp allows signup for the confirmed hold]
  T --> U[Cognito creates the BCSC user]
  U --> V[PostConfirmation migrates account data and transfers email claim]
  V --> W{Data and claim transfer succeed?}
  W -- No --> X[Rollback data and retain the BC Parks account]
  X --> S
  W -- Yes --> Y[Delete the old BC Parks account and complete the hold]
  Y --> Z[User continues with the migrated BCSC account]
```

## Security and lifecycle

- The email claim remains owned by the BC Parks account until the BCSC account
  data migration succeeds. `migrateHoldPending` only controls the source
  account's banner; it does not transfer the claim.
- Requesting the email requires the custom API authorizer and verifies that
  the authenticated username matches `oldParksUsername` on the hold.
- The confirmation route is public because the emailed token is its bearer
  credential. Only the SHA-256 token hash is stored. The token is random,
  single-use, conditionally checked against the pending hold, and expires with
  the hold.
- After email confirmation, the BC Parks account is signed out. The user must
  sign in with BCSC to create the BCSC account and start migration.
- The migration runs during the new user's initial
  `PostConfirmation_ConfirmSignUp`, not on subsequent
  `PostAuthentication_Authentication` events.
- If data migration fails, transferred records are rolled back, the hold is
  returned to `confirmed`, and the new BCSC user is deleted. This allows
  another BCSC sign-in attempt while preserving the old BC Parks account and
  email claim.
- If email-claim transfer fails after data migration succeeds, the handler
  does not delete the old account or mark the hold complete. This is a
  post-migration recovery case distinct from a failed data transfer.
