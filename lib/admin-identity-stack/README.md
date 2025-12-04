## IMPORTANT NOTES

Cognito UserPools have some immutable properties. If any of these properties are changed and deployed, a new UserPool will be (silently) created, and references will be repointed at the new pool.

Users within the old pool will not automatically be brought over to the new one. They can be migrated via script, but all users will be prompted to change their password the next time they log in to the new pool.