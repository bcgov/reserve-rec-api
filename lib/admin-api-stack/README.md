## BEFORE YOU REDEPLOY

AdminApiStack is generally safe to delete and recreate with minimal downtime. If you need to delete and recreate AdminApiStack, ensure the following steps are completed:

- The Admin Rest API will be recreated, resulting in a new API in APIGateway. All newly created endpoints should automatically be connected to this API, but Apps that rely on the API may have to be reconnected.
  - In particular, the ReserveRecAdmin front end will need to be redeployed, as its CloudFront Distribution behaviour for `/api/` will need to be pointed at the newly recreated RestAPI. Simply redeploying this app with no changes after recreating the AdminApiStack should result in the distribution pulling the correct RestAPI path from SSM.
- For all lambdas in the AdminApiStack that need permissions to access OpenSearch, their ARNs will need to be given the correct access permissions:
  1. Log into OpenSearch Dashboards -> Security -> Roles
  2. Ensure the following Lambdas have read access to the reference-data cluster
    - AdminApiStack-AdminSearchLambda
  3. It is safe to delete the old ARN backend-mapped roles.