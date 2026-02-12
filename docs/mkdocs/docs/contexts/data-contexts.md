# The Contexts of the Data Model
This data model is intentionally structured around several distinct contexts that describe every offering. Separating schemas based on these contexts ensure the system remains flexable, scalable, and capable of supporting any current or future experience type.

Each context encapsulates different aspects about any offering:

- [Spatial context](#spatial-context): **Where** does it occur?
- [Intent context](#intent-context): **What** is the experience?
- [Temporal context](#temporal-context): **When** is it available?
- [Governance context](#governance-context): **How** is it governed, restricted, or made available to users?
- [Identity context](#identity-context): **Who** is interacting with it?

![Contexts](../images/contexts.png)

In the detailed descriptions below, note that some schemas fall in to more than one category. This is intentional as these types often provide logical bridges between contexts.

## Spatial Context

"Where does the experience occur?"

Spatial context describes the physical location or region associated with an experience.

Spatial data answers *where* an experience takes place, independent of what the experience is or when it occurs. Spatial boundaries change slowly, but experiences and schedules change frequently.

By isolating spatial data, the system avoids unnecessary duplication and can support:
- multi‑park experiences
- partial‑park experiences
- user‑defined regions
- future non‑park experiences

## Intent Context

"What is the user doing?/What is the user wanting to do?"

Intent context defines the nature of the offering itself.

The intent layer answers *what* the experience is, independent of when it is offered. In some cases, the spatial context overlaps, as *where* an experience occurs quite often goes hand in hand with exactly *what* the experience is. Intent definitions evolve over time. New activities or product types can be introduced without restructuring spatial or temporal data. This keeps the model experience‑agnostic and future‑proof.

## Temporal Context

"When is the experience offered?"

Temporal context describes the time‑based availability of an experience.

The temporal layer answers *when* an experience is available. Temporal data changes frequently - yearly, seasonally, daily, sometimes faster. By isolating temporal context, the system can:
- regenerate schedules without touching spatial or experience data
- support rolling availability
- handle seasonal changes cleanly
- scale to millions of date‑specific items

## Governance Context

"How is the experience made available?"

Governance context defines the rules, constraints, and behaviours that control how an experience is offered.

This layer answers *how* the system regulates access to the experience. Governance rules change independently of location, experience type, or schedule.
By isolating governance:
- capacity, pricing, and other operational rules can change on a daily cadence without changing other aspects of the experience
- multiple experiences can share the same operational rules

## Identity Context

"Who is interacting with the experience"

The identity context describes the users, administrators, and system actors who interact with PRDT. It includes authentication state, roles, and permissions that determine what data is visible, what actions are allowed, and how governance rules are applied. Closely linked to governance context, identity is a cross‑cutting context that influences behaviour across spatial, experience, and temporal layers.
