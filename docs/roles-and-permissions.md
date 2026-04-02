# Roles and Permissions

In an attempt to streamline the complexity of the roles and permissions outlined in the [Confluence admin permission matrix](https://apps.nrs.gov.bc.ca/int/confluence/display/BCPRS/Admin+tool+permissions), we have established three primary roles and a fallback "Default" role.

## 1. Roles vs. Permissions

It is important to distinguish between a **Role** (what a user can do) and a **Permission** (where they can do it).

### Roles
* **Superadmin:** No restrictions. Full access to every facet of the app. Reserved for developers and high-level admins.
* **Staff:** Full Read/Write access. Restricted from `DELETE` operations on most items (with minor exceptions).
* **Limited:** Primarily Read-Only access. Allows `GET` requests for assigned collections. May include `PUT` capabilities for specific endpoints like `products` or `productDates`.
* **Default:** The baseline "Least Privilege" fallback. On the Public API, it allows restricted access to public data. On the Admin API, it ensures that unrecognized roles or missing mappings result in a 403 Forbidden or stripped data.

### Permissions
A **Permission** is a **Role** scoped to a specific `collectionId`. A user may hold different roles for different collections simultaneously. 

**Example Mapping:**
* `staff` for `bcparks_363`
* `limited` for `bcparks_250`


## 2. Implementation: The Authorizers

We use a **Hybrid Security Model** to balance AWS performance limits with granular security requirements.

### Public Authorizer
Allows all requests through. It optionally validates a Cognito token if present, attaching authentication state and admission cookie context to the `requestContext`. This could allow downstream handlers to distinguish between "Guest" and "Authenticated" public users.

### Admin Authorizer
The Admin Authorizer performs two critical functions before the request ever reaches a backend handler:

#### Layer 1: IAM Policy Allocation
The authorizer fetches the `resourceMap` for the user's assigned tiers and builds a broad IAM policy. To keep the policy within the 16KB AWS limit, we use wildcarded ARNs (e.g., `GET/facilities/*`). This confirms the user is allowed to use the "Facilities" tools in general.

#### Layer 2: The Context (JSON Object)
The authorizer attaches the specific user mapping to the `requestContext`. This allows the backend to know exactly which parks the user owns.


### Database Items Examples
---

**Database User Item:**
```json
{
  "pk": "userid::<sub>",
  "sk": "base",
  "permissions": {
    "bcparks_363": "staff",
    "bcparks_250": "limited",
    "bcparks_7": "foo" 
  }
}
```

**Database Resource Map:**
```json
{
  "pk": "resourceMap::staff",
  "sk": "latest",
  "allowedPaths": [
    "GET/reports*",
    "GET/policies*",
    "GET/products*",
    "PUT/products*"
    ...
}
```
---
**Auth Object in Event**

Example auth object in an event when an authenticated user makes a request to a handler.

```json
{
  "requestContext": {
    "resourceId": "1234ad",
    "authorizer": {
        "cognitoSub": "asdf1234567-asdf123-asdf123-asdf1234",
        "permissions": "{\"bcparks_363\":\"staff\",\"bcparks_250\":\"limited\",\"bcparks_7\":\"foo\"}",
        "principalId": "asdf1234567-asdf123-asdf123-asdf1234567",
        "integrationLatency": 189,
        "isAuthenticated": "true",
        "username": "IDIR_-ASasdDFasG1231ASasdDFasG1234"
    }
  }
}
```

## 3. Evaluation & Sanitization in Handlers

Once a request passes the Authorizer, the backend Handler performs the final, granular verification.

### The `checkAuthContext` Step (Admin Only)

Admin handlers call `checkAuthContext` from the shared library. This method:

1.  Parses the `permissions` object from the `requestContext`.

2.  Checks the `collectionId` from the path parameters against the user's permissions.

3.  **Fail Fast:** If the user attempts to access a `collectionId` they do not own, a **403 Forbidden** is thrown immediately.

### The `filterByRole` Step (Public & Admin)

Finally, data is sanitized before being returned to the client. This ensures that even if a user has access to a collection, they only see the attributes permitted by their role.

```js
const ROLE_BASED_FILTERS = {
  staff: ["adminNotes"],
  limited: ["adminNotes"],
  default: ["adminNotes", "creationDate", "lastUpdated", "version"],
};

```

- **Public Flow:** Defaults to the `default` role. Results are stripped of `adminNotes`, `version`, and audit timestamps.

- **Admin Flow:** Uses the specific role for that collection (e.g., `staff`). Only `adminNotes` are removed for now.

- **Superadmin Flow:** No filters are applied; the full database object is returned.

### Summary

This two-tier approach ensures that our infrastructure (IAM) stays lightweight and scalable, while our code (Handlers) remains the strict source of truth for data sanitization and separation.

## Future Implementations

- Right now, all `userid` is provisioned manually by a dev. We should implement a UI where a `superadmin` can provision the correct permissions mappings for a user.
- Likewise, `resouceMaps` are manually created by a dev. These data items should be easily created/deleted from a UI in the admin by a `superadmin` - even creating new roles with different access capabilities that correspond to the `ROLE_BASED_FILTER`.
- Superadmins are allocated by a Cognito group, where they are then given super permission and wildcard (*) access to all endpoints in the IAM Policies. This is the only time a Cognito group is used to provision a role and permissions, so it might be better implemented in the future.
