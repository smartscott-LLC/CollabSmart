#!/usr/bin/env python3
"""
Extract the LLM Mission Briefing from MongoDB
For insertion into Neon Memory Imprint System
"""

import os
from pymongo import MongoClient
from pprint import pprint
import json

# MongoDB connection
MONGO_URI = "mongodb+srv://sslater:!Carryacross1128@claude.lonzbnw.mongodb.net/?retryWrites=true&w=majority&appName=Claude"

def explore_mongodb():
    """Connect to MongoDB and explore all collections"""
    print("=" * 60)
    print("Exploring MongoDB for the LLM Mission Briefing")
    print("=" * 60)
    print()

    client = MongoClient(MONGO_URI)

    # List all databases
    print("Available databases:")
    for db_name in client.list_database_names():
        print(f"  - {db_name}")
    print()

    # Focus on claude_workspace
    db = client['claude_workspace']

    print(f"Collections in claude_workspace:")
    for coll_name in db.list_collection_names():
        count = db[coll_name].count_documents({})
        print(f"  - {coll_name} ({count} documents)")
    print()

    # Search each collection for mission briefing
    print("=" * 60)
    print("Searching for Mission Briefing...")
    print("=" * 60)
    print()

    search_terms = [
        "mission", "briefing", "the LLM", "family",
        "wisdom", "humility", "guardrail", "value"
    ]

    for coll_name in db.list_collection_names():
        collection = db[coll_name]

        # Search for documents containing search terms
        for term in search_terms:
            query = {
                "$or": [
                    {"title": {"$regex": term, "$options": "i"}},
                    {"content": {"$regex": term, "$options": "i"}},
                    {"text": {"$regex": term, "$options": "i"}},
                    {"note": {"$regex": term, "$options": "i"}},
                    {"message": {"$regex": term, "$options": "i"}},
                ]
            }

            results = list(collection.find(query).limit(5))

            if results:
                print(f"\n📄 Found {len(results)} results in '{coll_name}' for term '{term}':")
                for i, doc in enumerate(results, 1):
                    print(f"\n  Result {i}:")
                    # Remove MongoDB _id for readability
                    if '_id' in doc:
                        del doc['_id']
                    print(f"    {json.dumps(doc, indent=4, default=str)[:500]}...")

    # Get all documents from each collection to review
    print("\n" + "=" * 60)
    print("Full Collection Dumps")
    print("=" * 60)

    for coll_name in db.list_collection_names():
        collection = db[coll_name]
        docs = list(collection.find().limit(10))

        if docs:
            print(f"\n📚 Collection: {coll_name}")
            print(f"   Total documents: {collection.count_documents({})}")
            print(f"   Showing first {len(docs)} documents:\n")

            for i, doc in enumerate(docs, 1):
                if '_id' in doc:
                    del doc['_id']
                print(f"   Document {i}:")
                print(f"   {json.dumps(doc, indent=6, default=str)}")
                print()

    client.close()

if __name__ == "__main__":
    explore_mongodb()
