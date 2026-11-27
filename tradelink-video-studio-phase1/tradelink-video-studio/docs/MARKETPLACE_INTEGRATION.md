# Marketplace integration (design record; the sync is built in Phase 5 Stage 3 — see PHASE-5-SYNC.md)

Source: the Phase 0 inspection of the live marketplace database (21 November 2026).

Allowed views and the exact verified columns (the maximum the Studio may ever read):

- public_campaign: id, scene, tag, title, body, cta_label, cta_action, sort_order, image_url
- public_categories: id, industry_id, name, description, image_url, sort_order
- public_contact: phone, whatsapp, telegram, email, address, working_hours
- public_industries: id, name, description, icon, sort_order, storefront
- public_product_images: id, product_id, url, sort_order
- public_products: id, name, category, description, image_url, unit, package_size,
  min_order_quantity, category_id, audience, retail_price, brand, sale_price, created_at,
  stock_status, stock_left, supplier_id
- public_promo_products: promotion_id, product_id
- public_promotions: id, name, kind, scope, supplier_id, category_id, product_id, discount_type,
  percent, amount, max_discount, buy_qty, get_qty, starts_at, ends_at, started_at, show_banner,
  banner_text
- public_supplier_categories: supplier_id, category_id
- public_suppliers: id, name, industry_id, location, about, logo_path

Rules: only these ten views; request explicit columns, never all; reject any unexpected column;
GET only; no function calls; no base tables; no automatic discovery; no supplier-documents bucket;
images only from the public product-images, supplier-products and supplier-logos buckets;
credentials server-side only; pages of at most 500 rows ordered by id (the API caps at 1000 rows and
8 seconds per request); a failed page fails the whole sync and leaves the previous copy untouched.
No automated probe reads marketplace base tables; base-table access was verified once with the
owner-run SELECT-only script and can be re-run when the marketplace changes.

The marketplace repository migrations are incomplete compared with the live database; rely on this
list, not on those migrations. Pending item F6: the owner has not yet confirmed that the live site
still loads products. The first sync must not run until that is closed.
