# Disaster Recovery — RPO < 5m, RTO < 30m
- **Backups:** RDS automated daily + 7-day PITR, S3 versioned, off-site cross-region copy `s3:PutObject` weekly.
- **Restore drill:** Quarterly `terraform apply -target=aws_db_instance.postgres` from snapshot to staging, `psql $DATABASE_URL -f server/migrations/*.sql` replay, `k6` smoke.
- **Runbook:** `infra/terraform/README.md` + `docs/RUNBOOK.md`
