# User Role Viewer

A tool to check user roles and permissions in both Cognito and OpenSearch.

## Usage

```bash
node scripts/tools/viewUserRoles.js
```

The script will interactively prompt you for:

1. **User Pool Selection**: Lists all Cognito User Pools in ca-central-1 region and lets you select one
2. **Username**: The username to check roles for
3. **OpenSearch Domain Endpoint**: The HTTPS endpoint of your OpenSearch domain

## Prerequisites

- AWS credentials configured (via AWS CLI, environment variables, or IAM role)
- Permissions to:
  - List Cognito User Pools (`cognito-idp:ListUserPools`)
  - List user groups (`cognito-idp:AdminListGroupsForUser`)
  - Access OpenSearch domain security API

## Output

The script will display:
- **Cognito Groups**: Groups assigned to the user in the selected User Pool
- **OpenSearch Backend Roles**: Roles mapped to the user in OpenSearch
- **Dashboard Tenants**: Available tenants for the user
- **Cluster Permissions**: OpenSearch cluster-level permissions

## Troubleshooting

If you encounter "Missing Role" errors in OpenSearch Dashboards:

1. Check if the user has Cognito groups assigned
2. Verify Cognito groups are mapped to OpenSearch roles
3. Ensure the OpenSearch domain has Cognito authentication enabled
4. Confirm the Identity Pool has proper role mappings

## Example Output

```
🔍 User Role Viewer for OpenSearch and Cognito
===============================================

Available User Pools:
1. prdt-reserve-user-pool (ca-central-1_ABC123XYZ)
2. test-pool (ca-central-1_DEF456UVW)

Select user pool (enter number): 1

Selected User Pool: prdt-reserve-user-pool (ca-central-1_ABC123XYZ)

Enter username to check: cameronpettit

Checking roles for user: cameronpettit

Enter OpenSearch domain endpoint: https://search-prdt-reserve-os-example.ca-central-1.es.amazonaws.com

Using OpenSearch domain: https://search-prdt-reserve-os-example.ca-central-1.es.amazonaws.com

==================================================

📝 Checking Cognito Groups...
Cognito groups: ['admin', 'user']

🔒 Checking OpenSearch Security...
OpenSearch backend_roles: ['admin_role', 'user_role']
Dashboards tenants: ['global_tenant', 'private']
Cluster permissions: ['cluster_composite_ops', 'cluster_monitor']

==================================================
✅ Role check complete!
```