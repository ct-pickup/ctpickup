When you add a new shared file under `lib/pickup/`, you must also make it available to the mobile app.

The mobile app imports many pickup helpers from `@/lib/...` and expects a mirrored copy under `mobile/lib/pickup/`.

Run this script after creating/updating shared pickup libs:

```bash
node scripts/sync-mobile-lib-pickup.mjs
```

To force overwrite existing mobile copies:

```bash
node scripts/sync-mobile-lib-pickup.mjs --overwrite
```

This script copies `.ts` / `.tsx` files from `lib/pickup/` → `mobile/lib/pickup/`.
It never deletes anything in `mobile/lib/pickup/`.

