# AWS Enterprise Postgres — Multi-Region Replication
Cluster: RDS Postgres 16 Multi-AZ + cross-region read replica me-central-1 (UAE) -> eu-central-1 Frankfurt.
Replication: synchronous_commit = remote_apply for ledger, async for reads.
Supabase: DATABASE_URL=postgresql://postgres:@db.supabase.co:5432/postgres — same server/migrations/postgres_init.sql applies.
Failover: Route53 health check on /api/health (RTO <60s).
Encryption: rds.force_ssl=1, AES-256-GCM app-layer (server/lib/crypto.js) + pgcrypto at rest, KMS CMK for ENCRYPTION_KEY.
Backups: automated 7-day + scripts/backup.sh VACUUM INTO to S3 cross-region.
See server/migrations/postgres_init.sql and prisma/schema.prisma.
