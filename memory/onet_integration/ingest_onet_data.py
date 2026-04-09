#!/usr/bin/env python3
"""
O*NET Data Ingestion Script for the LLM
Fetches occupation data from O*NET Web Services API v2 and loads into Neon PostgreSQL
"""

import os
import sys
import requests
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
from urllib.parse import urlparse
import time

# Load environment variables
load_dotenv('../memory_system/.env')

# Configuration
ONET_API_KEY = os.getenv('ONET_API_KEY')
ONET_API_BASE = os.getenv('ONET_API_BASE', 'https://api-v2.onetcenter.org')
POSTGRES_URL = os.getenv('POSTGRES_URL')

# Headers for O*NET API
HEADERS = {
    'X-API-Key': ONET_API_KEY,
    'Accept': 'application/json'
}

# Broad search terms to get diverse occupations
SEARCH_TERMS = ['manager', 'engineer', 'analyst', 'technician', 'specialist']

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

def search_occupations(keyword, limit_per_search=10):
    """Search for occupations using keyword"""
    print(f"Searching for '{keyword}'...")

    url = f"{ONET_API_BASE}/online/search"
    params = {'keyword': keyword, 'start': 1, 'end': limit_per_search}

    try:
        response = requests.get(url, headers=HEADERS, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        occupations = data.get('occupation', [])
        print(f"  ✓ Found {len(occupations)} occupations")
        return occupations
    except Exception as e:
        print(f"  ⚠ Error searching: {e}")
        return []

def fetch_occupation_details(onet_code):
    """Fetch detailed information for a specific occupation"""
    url = f"{ONET_API_BASE}/online/occupations/{onet_code}"

    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"  ⚠ Error fetching {onet_code}: {e}")
        return None

def insert_occupation(conn, occ_data):
    """Insert occupation into database"""
    cursor = conn.cursor()

    sql = """
        INSERT INTO onet_occupations
            (onetsoc_code, title, description, bright_outlook, api_url)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (onetsoc_code)
        DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            bright_outlook = EXCLUDED.bright_outlook,
            updated_at = NOW()
    """

    # Extract values
    code = occ_data.get('code')
    title = occ_data.get('title')
    description = occ_data.get('description', '')
    bright_outlook = occ_data.get('tags', {}).get('bright_outlook', False)
    api_url = occ_data.get('href', '')

    values = (code, title, description, bright_outlook, api_url)

    cursor.execute(sql, values)
    cursor.close()

def ingest_sample_occupations(num_occupations=30):
    """
    Ingest a sample set of occupations into the LLM's database

    Args:
        num_occupations: Target number of occupations to ingest (default: 30)
    """
    print("=" * 60)
    print("the LLM O*NET Data Ingestion (Mission Critical)")
    print("=" * 60)
    print()

    # Verify API key
    if not ONET_API_KEY:
        print("❌ Error: ONET_API_KEY not found in .env")
        sys.exit(1)

    # Connect to database
    print("Connecting to Neon PostgreSQL...")
    try:
        conn = get_db_connection()
        print("✓ Connected to Neon database")
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        sys.exit(1)

    try:
        # Collect occupations from multiple searches
        all_occupations = []
        occupations_per_search = max(1, num_occupations // len(SEARCH_TERMS))

        print(f"\nFetching {num_occupations} occupations using diverse search terms...")
        for term in SEARCH_TERMS:
            occs = search_occupations(term, occupations_per_search)
            all_occupations.extend(occs)
            time.sleep(0.5)  # Rate limiting

            if len(all_occupations) >= num_occupations:
                break

        # Deduplicate by code
        seen_codes = set()
        unique_occupations = []
        for occ in all_occupations:
            code = occ.get('code')
            if code not in seen_codes:
                seen_codes.add(code)
                unique_occupations.append(occ)

        occupations_to_process = unique_occupations[:num_occupations]

        print(f"\n✓ Collected {len(occupations_to_process)} unique occupations")
        print("\nProcessing and inserting into Neon...")

        # Process each occupation
        successful = 0
        failed = 0

        for i, occ in enumerate(occupations_to_process, 1):
            code = occ.get('code')
            title = occ.get('title')

            print(f"[{i}/{len(occupations_to_process)}] {code}: {title}")

            # Get detailed info
            details = fetch_occupation_details(code)

            if details:
                try:
                    insert_occupation(conn, details)
                    conn.commit()
                    successful += 1
                    print(f"  ✓ Inserted")
                except Exception as e:
                    print(f"  ✗ Insert failed: {e}")
                    conn.rollback()
                    failed += 1
            else:
                failed += 1

            # Rate limiting - be nice to O*NET API
            time.sleep(0.5)

        print()
        print("=" * 60)
        print(f"✅ Ingestion Complete!")
        print(f"   Successful: {successful}")
        print(f"   Failed: {failed}")
        print("=" * 60)

        # Show sample data
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM onet_occupations")
        total = cursor.fetchone()[0]
        print(f"\n✨ Total occupations in the LLM's Neon database: {total}")

        cursor.execute("""
            SELECT onetsoc_code, title, bright_outlook
            FROM onet_occupations
            WHERE bright_outlook = TRUE
            LIMIT 5
        """)
        bright_outlook_occs = cursor.fetchall()

        if bright_outlook_occs:
            print("\n🌟 Sample Bright Outlook Occupations:")
            for code, title, _ in bright_outlook_occs:
                print(f"   • {code}: {title}")

        cursor.close()

    finally:
        conn.close()
        print("\n✓ Database connection closed")

if __name__ == "__main__":
    # Default: ingest 30 occupations as a starter dataset
    num = int(sys.argv[1]) if len(sys.argv) > 1 else 30

    print(f"\n🚀 Starting ingestion of {num} occupations...")
    print("This will give the LLM knowledge about various careers!\n")

    ingest_sample_occupations(num)
