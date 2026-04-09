#!/usr/bin/env python3
"""
Specialized Agent Factory - Database Migration Script

This script safely deploys the agent factory schema to your PostgreSQL database.
It handles:
- Schema creation
- Initial partitioning setup
- Index creation with progress tracking
- Validation and rollback on errors

Usage:
    python migrate_agent_factory.py --database-url "postgresql://..."
    python migrate_agent_factory.py --env-file .env
    python migrate_agent_factory.py --dry-run  # Test without committing

Author: Claude (Principal Architect)
Date: 2025-10-18
"""

import os
import sys
import argparse
import logging
from datetime import datetime, timedelta
from typing import Optional
import psycopg2
from psycopg2 import sql
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class AgentFactoryMigration:
    """Handles migration of Agent Factory schema to PostgreSQL."""

    def __init__(self, database_url: str, dry_run: bool = False):
        self.database_url = database_url
        self.dry_run = dry_run
        self.conn: Optional[psycopg2.extensions.connection] = None

    def connect(self):
        """Establish database connection."""
        try:
            logger.info("Connecting to database...")
            self.conn = psycopg2.connect(self.database_url)
            logger.info("✓ Connected successfully")
        except Exception as e:
            logger.error(f"✗ Failed to connect: {e}")
            sys.exit(1)

    def disconnect(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()
            logger.info("Disconnected from database")

    def check_prerequisites(self) -> bool:
        """Check if required extensions and tables exist."""
        logger.info("\nChecking prerequisites...")

        checks = [
            ("pgvector extension", "SELECT 1 FROM pg_extension WHERE extname = 'vector'"),
            ("onet_occupations table", "SELECT 1 FROM information_schema.tables WHERE table_name = 'onet_occupations'"),
            ("long_term_memory table", "SELECT 1 FROM information_schema.tables WHERE table_name = 'long_term_memory'"),
        ]

        all_passed = True
        cursor = self.conn.cursor()

        for check_name, check_query in checks:
            try:
                cursor.execute(check_query)
                result = cursor.fetchone()
                if result:
                    logger.info(f"  ✓ {check_name}")
                else:
                    logger.warning(f"  ⚠ {check_name} not found (optional)")
            except Exception as e:
                logger.warning(f"  ⚠ {check_name} check failed: {e}")

        cursor.close()
        return all_passed

    def table_exists(self, table_name: str) -> bool:
        """Check if a table already exists."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name = %s",
            (table_name,)
        )
        exists = cursor.fetchone() is not None
        cursor.close()
        return exists

    def create_schema(self):
        """Create all tables, indexes, and functions."""
        logger.info("\nCreating Agent Factory schema...")

        # Read schema file
        schema_path = os.path.join(os.path.dirname(__file__), 'schema_agent_factory.sql')

        if not os.path.exists(schema_path):
            logger.error(f"✗ Schema file not found: {schema_path}")
            sys.exit(1)

        with open(schema_path, 'r') as f:
            schema_sql = f.read()

        if self.dry_run:
            logger.info("DRY RUN: Would execute schema creation")
            logger.debug(f"Schema SQL:\n{schema_sql[:500]}...")
            return

        cursor = self.conn.cursor()

        try:
            # Execute schema creation
            logger.info("  Executing schema SQL...")
            cursor.execute(schema_sql)
            self.conn.commit()
            logger.info("  ✓ Schema created successfully")

        except Exception as e:
            logger.error(f"  ✗ Schema creation failed: {e}")
            self.conn.rollback()
            raise

        finally:
            cursor.close()

    def create_monthly_partitions(self, months_ahead: int = 3):
        """Create partitions for current month + N months ahead."""
        logger.info(f"\nCreating monthly partitions ({months_ahead} months ahead)...")

        cursor = self.conn.cursor()

        # Start from current month
        current_date = datetime.now().replace(day=1)

        for i in range(months_ahead + 1):
            partition_date = current_date + timedelta(days=30 * i)
            partition_name = f"agent_invocations_{partition_date.strftime('%Y_%m')}"
            start_date = partition_date.strftime('%Y-%m-01')

            # Calculate end date (first day of next month)
            if partition_date.month == 12:
                end_date = f"{partition_date.year + 1}-01-01"
            else:
                end_date = f"{partition_date.year}-{partition_date.month + 1:02d}-01"

            # Check if partition already exists
            cursor.execute(
                "SELECT 1 FROM pg_class WHERE relname = %s",
                (partition_name,)
            )
            if cursor.fetchone():
                logger.info(f"  ⊙ Partition {partition_name} already exists")
                continue

            if self.dry_run:
                logger.info(f"  DRY RUN: Would create partition {partition_name}")
                continue

            try:
                # Create partition
                create_partition_sql = sql.SQL("""
                    CREATE TABLE {partition_name} PARTITION OF agent_invocations
                    FOR VALUES FROM ({start_date}) TO ({end_date})
                """).format(
                    partition_name=sql.Identifier(partition_name),
                    start_date=sql.Literal(start_date),
                    end_date=sql.Literal(end_date)
                )

                cursor.execute(create_partition_sql)
                self.conn.commit()
                logger.info(f"  ✓ Created partition {partition_name} ({start_date} to {end_date})")

            except Exception as e:
                logger.error(f"  ✗ Failed to create partition {partition_name}: {e}")
                self.conn.rollback()
                raise

        cursor.close()

    def verify_schema(self) -> bool:
        """Verify that all expected tables exist."""
        logger.info("\nVerifying schema...")

        expected_tables = [
            'specialized_agents',
            'agent_invocations',
            'agent_evolution_history',
            'agent_performance_snapshots',
        ]

        cursor = self.conn.cursor()
        all_exist = True

        for table_name in expected_tables:
            cursor.execute(
                "SELECT 1 FROM information_schema.tables WHERE table_name = %s",
                (table_name,)
            )
            if cursor.fetchone():
                logger.info(f"  ✓ {table_name}")
            else:
                logger.error(f"  ✗ {table_name} NOT FOUND")
                all_exist = False

        cursor.close()

        if all_exist:
            logger.info("✓ All tables verified")
        else:
            logger.error("✗ Schema verification failed")

        return all_exist

    def verify_indexes(self) -> bool:
        """Verify that critical indexes exist."""
        logger.info("\nVerifying indexes...")

        critical_indexes = [
            'idx_agents_code',
            'idx_agents_capabilities',
            'idx_invocations_agent',
            'idx_invocations_timestamp',
        ]

        cursor = self.conn.cursor()
        all_exist = True

        for index_name in critical_indexes:
            cursor.execute(
                "SELECT 1 FROM pg_indexes WHERE indexname = %s",
                (index_name,)
            )
            if cursor.fetchone():
                logger.info(f"  ✓ {index_name}")
            else:
                logger.warning(f"  ⚠ {index_name} NOT FOUND (may need manual creation)")
                all_exist = False

        cursor.close()

        if all_exist:
            logger.info("✓ All critical indexes verified")

        return all_exist

    def get_table_stats(self):
        """Get statistics about created tables."""
        logger.info("\nTable statistics:")

        cursor = self.conn.cursor()

        cursor.execute("""
            SELECT
                schemaname,
                tablename,
                pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
                n_live_tup as row_count
            FROM pg_stat_user_tables
            WHERE tablename IN ('specialized_agents', 'agent_invocations',
                                'agent_evolution_history', 'agent_performance_snapshots')
            ORDER BY tablename
        """)

        results = cursor.fetchall()

        for schema, table, size, row_count in results:
            logger.info(f"  {table}: {row_count} rows, {size}")

        cursor.close()

    def run_migration(self):
        """Execute full migration process."""
        logger.info("=" * 60)
        logger.info("AGENT FACTORY DATABASE MIGRATION")
        logger.info("=" * 60)

        if self.dry_run:
            logger.info("MODE: DRY RUN (no changes will be committed)")
        else:
            logger.info("MODE: LIVE (changes will be committed)")

        try:
            # Step 1: Connect
            self.connect()

            # Step 2: Check prerequisites
            self.check_prerequisites()

            # Step 3: Check if tables already exist
            if self.table_exists('specialized_agents'):
                logger.warning("\n⚠ WARNING: specialized_agents table already exists!")
                response = input("Continue anyway? This may fail if schema differs. (y/N): ")
                if response.lower() != 'y':
                    logger.info("Migration cancelled by user")
                    return

            # Step 4: Create schema
            self.create_schema()

            # Step 5: Create partitions
            self.create_monthly_partitions(months_ahead=3)

            # Step 6: Verify schema
            if not self.verify_schema():
                logger.error("Schema verification failed. Migration may be incomplete.")
                sys.exit(1)

            # Step 7: Verify indexes
            self.verify_indexes()

            # Step 8: Show statistics
            if not self.dry_run:
                self.get_table_stats()

            # Success
            logger.info("\n" + "=" * 60)
            if self.dry_run:
                logger.info("DRY RUN COMPLETED SUCCESSFULLY")
            else:
                logger.info("✓ MIGRATION COMPLETED SUCCESSFULLY")
            logger.info("=" * 60)

            logger.info("\nNext steps:")
            logger.info("  1. Seed initial agents (if applicable)")
            logger.info("  2. Set up automated partition creation (cron job)")
            logger.info("  3. Configure monitoring dashboards")
            logger.info("  4. Test agent synthesis pipeline")

        except Exception as e:
            logger.error(f"\n✗ Migration failed: {e}")
            logger.exception("Full traceback:")
            sys.exit(1)

        finally:
            self.disconnect()


def main():
    parser = argparse.ArgumentParser(
        description="Migrate Agent Factory schema to PostgreSQL"
    )

    parser.add_argument(
        '--database-url',
        help='PostgreSQL connection string (postgresql://user:pass@host/db)'
    )
    parser.add_argument(
        '--env-file',
        help='Path to .env file containing DATABASE_URL'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Test migration without committing changes'
    )

    args = parser.parse_args()

    # Get database URL
    database_url = None

    if args.database_url:
        database_url = args.database_url
    elif args.env_file:
        # Load from .env file
        if not os.path.exists(args.env_file):
            logger.error(f"✗ .env file not found: {args.env_file}")
            sys.exit(1)

        with open(args.env_file, 'r') as f:
            for line in f:
                if line.startswith('DATABASE_URL='):
                    database_url = line.split('=', 1)[1].strip().strip('"').strip("'")
                    break
    else:
        # Try environment variable
        database_url = os.environ.get('DATABASE_URL')

    if not database_url:
        logger.error("✗ Database URL not provided. Use --database-url, --env-file, or set DATABASE_URL env var")
        sys.exit(1)

    # Run migration
    migration = AgentFactoryMigration(database_url, dry_run=args.dry_run)
    migration.run_migration()


if __name__ == '__main__':
    main()
