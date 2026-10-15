# Archived MySQL schema and migration history

These files preserve the schema and migration history before the PostgreSQL
conversion on October 15, 2026. They do not run during the current deployment.
No existing MySQL database or its data is changed by this conversion.

The active PostgreSQL migration starts a fresh database. Importing existing
MySQL users, manuscripts, orders, or payments is a separate data migration;
do not point these MySQL migrations at PostgreSQL or mark them as applied there.
