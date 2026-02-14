# Policies

Policies define the rules that govern how reservations behave across the entire system.

They describe:
- when users can make reservations
- how users can modify or cancel existing reservations
- who can participate in the experience they are reserving
- what they will be charged for the experience

Policies are reusable, versioned ruleset templates that allow administrators to create new Products and ProductDates with preconfigured governance rules.

## Shared Policy Concepts
Every policy has:
- a policy type (reservation, change, party, fee)
- a policyId (the logical identifier)
- a policyIdVersion (the version number)
- a displayName and description
- metadata such as creation and update timestamps

This ensures policies are easy to reference, audit, and evolve.

Policies are never edited in place. Instead:
- A new version is created when rules change.
- Products can preconfigured to always use the latest policy version, or lock in a specific version.
- Existing bookings retain the old version.

This protects users from retroactive rule changes and provides a clear audit trail.

All policy types share a common evaluation pattern:
- Time based rules can be anchored to fixed times or can be dependent on anchors defined at reservation time, like user-selected arrival and depature dates
- Time‑based rules anchor to local park time, not UTC.
- All calculations - time-based, money-based, or otherwise, must be deterministic.
- All rules are denormalized/resolved before runtime evaluation.

## Policy Primitives
Policies are comprised of primitives to break down complex rulesets into more simple, deterministic building blocks. View primitives [here](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---8.-Policies---1.-Primitives).




