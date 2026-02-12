# Policies

Policies define the rules that govern how reservations behave across the entire system.

They describe:
- when users can make reservations
- how users can modify or cancel existing reservations
- who can participate in the experience they are reserving
- what they will be charged for the experience

Policies are reusable, versioned rulesets that allow BC Parks to manage complex governance without duplicating logic across thousands of products and productDates.

Although each policy type focuses on a different aspect of reservation behaviour, they all share a common structure and lifecycle:
- They are reusable - a single policy can apply to many products.
- They are versioned - once they are referenced to make bookings, they are immutable to that booking
- They are resolved into productDates - all policy logic is denormalized into each productDate for fast, predictable evaluation.
- They support granular behaviour - products can specify alternate policies for specific dates or seasons.

Policies allow the system to express governance rules in a consistent, maintainable way. Without policies, each product would need to embed its own governance rules, leading to duplication, drift, and inconsistent behaviour. By centralizing policy rules into policy objects:
- BC Parks can update rules in one place.
- Products remain lightweight and focused on describing the offering.
- ProductDates can be generated with fully resolved, immutable governance rules, and regenerated easily if necessary.
- Bookings retain the exact rules that applied at the time of purchase.

Policies are the backbone of the system's governance model.

## Policy Design Philosophy

The policy language is intentionally small, compositional, and domain‑aligned. Its purpose is not to become a general‑purpose programming language, but to provide a precise, deterministic vocabulary for expressing reservation rules, fee logic, and operational constraints. Every primitive exists to make real policies easier to express, easier to audit, and harder to misinterpret.

The following principles guide the design of the DSL:

### Minimalism over expressiveness

The language includes only the primitives required to model real reservation policies. Features that add conceptual weight without solving a domain problem are excluded.

### Compositional building blocks

Policies are comprised of primitives. Each primitive is small and focused. More complex rules emerge by composing primitives rather than introducing special‑case operators or nested logic structures.

### Determinism and auditability

Every expression must evaluate deterministically. There are no side effects, no hidden state, and no ambiguous operators.

###  Future‑proof, but not speculative

New primitives are added only when a real policy requires them. The language evolves in response to operational needs, not hypothetical scenarios.

## Shared Policy Concepts
Every policy has:
- a policy type (booking, change, party, fee)
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
- Overrides are applied before denormalization, ensuring ProductDates are immutable.

This makes runtime evaluation simple and predictable.

## Policy Primitives
Policies are comprised of primitives to break down complex rulesets into more simple, deterministic building blocks. View primitives [here](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---8.-Policies---1.-Primitives).

# Policy Types
The system defines these core policy types:
- [Booking Policy](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---8.-Policies---2.-Booking-Policies) — when users can book,  and how stays are structured
- [Party Policy](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---8.-Policies---3.-Party-Policies) — who can participate and how groups are structured
- [Fee Policy](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---8.-Policies---4.-Fee-Policies) — what users pay and how charges are calculated





