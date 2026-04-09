#!/usr/bin/env python3
"""
the LLM Strategic O*Net Occupation Ingestion
Ingests the 50 carefully selected occupations for the LLM's expanded knowledge
"""

import os
import sys
import requests
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
from urllib.parse import urlparse
import time
from pathlib import Path

# Load environment variables
env_path = Path(__file__).parent.parent / 'memory_system' / '.env'
load_dotenv(env_path)

# Configuration
ONET_API_KEY = os.getenv('ONET_API_KEY')
ONET_API_BASE = os.getenv('ONET_API_BASE', 'https://api-v2.onetcenter.org')
POSTGRES_URL = os.getenv('POSTGRES_URL')

# Headers for O*NET API
HEADERS = {
    'X-API-Key': ONET_API_KEY,
    'Accept': 'application/json'
}

def get_db_connection():
    """Connect to Neon PostgreSQL"""
    result = urlparse(POSTGRES_URL)
    conn = psycopg2.connect(
        database=result.path[1:],
        user=result.username,
        password=result.password,
        host=result.hostname,
        port=result.port,
        sslmode='require'
    )
    return conn

def load_occupation_codes(filepath):
    """Load O*Net SOC codes from file"""
    codes = []
    with open(filepath, 'r') as f:
        for line in f:
            line = line.strip()
            # Skip comments and empty lines
            if line and not line.startswith('#'):
                # Extract code (first token before any comment)
                code = line.split('#')[0].strip()
                if code:
                    codes.append(code)
    return codes

def fetch_occupation_details(onet_code):
    """Fetch detailed information for a specific occupation from O*NET"""
    # Use the correct O*NET API v2 endpoint
    url = f"{ONET_API_BASE}/online/occupations/{onet_code}"

    try:
        response = requests.get(url, headers=HEADERS, timeout=10)

        if response.status_code == 200:
            return response.json()
        elif response.status_code == 404:
            print(f"  ⚠ Occupation {onet_code} not found in O*NET database")
            return None
        else:
            print(f"  ⚠ Error {response.status_code} fetching {onet_code}")
            return None

    except Exception as e:
        print(f"  ⚠ Error fetching {onet_code}: {e}")
        return None

def insert_occupation(conn, occ_data, onet_code):
    """Insert occupation into database"""
    cursor = conn.cursor()

    sql = """
        INSERT INTO onet_occupations
            (onetsoc_code, title, description, api_url)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (onetsoc_code)
        DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            updated_at = NOW()
    """

    # Extract values - handle both detailed and search result formats
    title = occ_data.get('title') or occ_data.get('occupation', {}).get('title', 'Unknown')
    description = occ_data.get('description', '')

    # If description is empty, try to get it from occupation object
    if not description and 'occupation' in occ_data:
        description = occ_data['occupation'].get('description', '')

    api_url = occ_data.get('href', f"{ONET_API_BASE}/online/occupations/{onet_code}")

    values = (onet_code, title, description, api_url)

    cursor.execute(sql, values)
    cursor.close()

def ingest_strategic_occupations():
    """
    Ingest the 50 strategic occupations for the LLM
    """
    print("=" * 70)
    print("the LLM Strategic O*Net Occupation Ingestion")
    print("Expanding the LLM's Knowledge Base")
    print("=" * 70)
    print()

    # Load occupation codes
    codes_file = Path(__file__).parent / 'the LLM_strategic_occupations.txt'

    if not codes_file.exists():
        print(f"❌ Error: {codes_file} not found")
        sys.exit(1)

    print(f"📋 Loading occupation codes from: {codes_file.name}")
    occupation_codes = load_occupation_codes(codes_file)
    print(f"✓ Loaded {len(occupation_codes)} occupation codes\n")

    # Verify API key
    if not ONET_API_KEY:
        print("❌ Error: ONET_API_KEY not found in .env")
        sys.exit(1)

    # Connect to database
    print("🔌 Connecting to Neon PostgreSQL...")
    try:
        conn = get_db_connection()
        print("✓ Connected to Neon database\n")
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        sys.exit(1)

    try:
        print(f"🚀 Beginning ingestion of {len(occupation_codes)} occupations...\n")

        successful = 0
        failed = 0
        failed_codes = []

        for i, code in enumerate(occupation_codes, 1):
            print(f"[{i}/{len(occupation_codes)}] {code}")

            # Fetch detailed occupation data
            details = fetch_occupation_details(code)

            if details:
                try:
                    insert_occupation(conn, details, code)
                    conn.commit()
                    successful += 1

                    # Get the title for nice output
                    title = details.get('title') or details.get('occupation', {}).get('title', 'Unknown')
                    print(f"  ✓ Inserted: {title}")

                except Exception as e:
                    print(f"  ✗ Insert failed: {e}")
                    conn.rollback()
                    failed += 1
                    failed_codes.append(code)
            else:
                failed += 1
                failed_codes.append(code)

            # Rate limiting - be respectful to O*NET API
            time.sleep(0.5)

        print()
        print("=" * 70)
        print(f"✅ Ingestion Complete!")
        print(f"   Successful: {successful}")
        print(f"   Failed: {failed}")

        if failed_codes:
            print(f"\n⚠ Failed codes:")
            for code in failed_codes:
                print(f"   - {code}")

        print("=" * 70)

        # Show final statistics
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM onet_occupations")
        total = cursor.fetchone()[0]

        print(f"\n✨ Total occupations in the LLM's knowledge base: {total}")

        # Show some examples from new data
        cursor.execute("""
            SELECT onetsoc_code, title
            FROM onet_occupations
            WHERE onetsoc_code = ANY(%s)
            ORDER BY title
            LIMIT 10
        """, (occupation_codes[:10],))

        sample_occs = cursor.fetchall()

        if sample_occs:
            print("\n📚 Sample of newly added occupations:")
            for code, title in sample_occs:
                print(f"   • {code}: {title}")

        cursor.close()

    finally:
        conn.close()
        print("\n✓ Database connection closed")
        print("\n🎯 the LLM's knowledge base has been strategically expanded!")

if __name__ == "__main__":
    print("\n🧠 Expanding the LLM's O*Net Knowledge")
    print("Strategic occupations selected by Claude for:")
    print("  - Wisdom-based orchestration")
    print("  - Workforce development expertise")
    print("  - Ethics and human-centered AI")
    print("  - HelixSphere long-term vision\n")

    ingest_strategic_occupations()
