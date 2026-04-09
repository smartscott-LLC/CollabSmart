#!/usr/bin/env python3
"""
Apply the LLM PostgreSQL Schema to Neon Database

This script reads the schema.sql file and applies it to the Neon PostgreSQL database.
"""

import psycopg2
import os
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
load_dotenv()

def apply_schema():
    """Apply the PostgreSQL schema to Neon database"""

    # Get database URL from environment
    database_url = os.getenv("NEON_DATABASE_URL")

    if not database_url:
        print("❌ Error: NEON_DATABASE_URL not found in .env")
        return False

    # Read schema file
    schema_path = Path(__file__).parent / "database" / "schema.sql"

    if not schema_path.exists():
        print(f"❌ Error: Schema file not found at {schema_path}")
        return False

    with open(schema_path, 'r') as f:
        schema_sql = f.read()

    print(f"📄 Read schema from {schema_path}")

    # Connect to database and apply schema
    try:
        print(f"🔗 Connecting to Neon PostgreSQL...")
        conn = psycopg2.connect(database_url)
        cur = conn.cursor()

        print("📊 Applying schema...")
        cur.execute(schema_sql)

        conn.commit()
        print("✅ Schema applied successfully!")

        # Verify tables were created
        cur.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name LIKE 'the LLM_%'
            ORDER BY table_name;
        """)

        tables = cur.fetchall()
        print(f"\n✅ Created {len(tables)} the LLM tables:")
        for table in tables:
            print(f"   - {table[0]}")

        cur.close()
        conn.close()

        return True

    except Exception as e:
        print(f"❌ Error applying schema: {e}")
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("the LLM PostgreSQL Schema Application")
    print("=" * 60)
    print()

    success = apply_schema()

    print()
    if success:
        print("🎉 the LLM long-term memory database is ready!")
        print()
        print("Next steps:")
        print("1. Rebuild Docker image: docker build -t the LLM-personality:latest .")
        print("2. Deploy the LLM: docker-compose -f ../../../deploy/compose/docker-compose-the LLM.yaml up -d")
        print("3. Test memory: curl http://localhost:8088/learning/summary")
    else:
        print("❌ Schema application failed. Please check the error above.")

    print()
    print("=" * 60)
