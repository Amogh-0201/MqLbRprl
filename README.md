## Routes to Implement
 *=> implies authentication needed
### Auth
    POST /api/v1/auth/register
    POST /api/v1/auth/login
    *GET /api/v1/users/me

### Products
    GET    /api/v1/products
    GET    /api/v1/products/:id
    *POST   /api/v1/products
    *PATCH  /api/v1/products/:id
    *DELETE /api/v1/products/:id

### Orders
    *POST /api/v1/orders
    *GET  /api/v1/orders
    *GET  /api/v1/orders/:id
    *PATCH /api/v1/orders/:id/status
    *PATCH /api/v1/orders/:id/quantity
    *DELETE  /api/v1/orders/:id