# Shopee Products Dashboard

A local dashboard that lists Shopee products and the number of items sold for a selected time period.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in your Shopee Open Platform `partner_id`, `partner_key`, and `shop_id`.
3. If you already have an access token, add it to `.env`.
4. If you need to authorize the shop, set your Shopee app callback URL to:

   ```text
   http://localhost:3000/auth/callback
   ```

5. Start the dashboard:

   ```bash
   npm start
   ```

6. Open:

   ```text
   http://localhost:3000
   ```

If you do not have an access token yet, use the **Authorize shop** button after starting the dashboard.

## Notes

- Sold quantities are calculated from completed Shopee orders in the selected period.
- Product details come from Shopee Open API v2 product endpoints.
- Credentials and tokens stay local in `.env` and `.shopee-token.json`.
