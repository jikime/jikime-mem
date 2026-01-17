#!/usr/bin/env python3
"""
Chroma CLI - jikime-mem Chroma 데이터 확인 도구

사용법:
  python scripts/chroma-cli.py status      # 컬렉션 상태 확인
  python scripts/chroma-cli.py list [n]    # 문서 목록 (기본 10개)
  python scripts/chroma-cli.py search "쿼리"  # 시맨틱 검색
  python scripts/chroma-cli.py types       # 문서 타입별 통계
"""

import sys
import chromadb
from pathlib import Path
from collections import Counter

VECTOR_DB_DIR = Path.home() / '.jikime-mem' / 'vector-db'
COLLECTION_NAME = 'jm__jikime_mem'


def get_client():
    return chromadb.PersistentClient(path=str(VECTOR_DB_DIR))


def get_collection(client):
    try:
        return client.get_collection(COLLECTION_NAME)
    except Exception as e:
        print(f"❌ Collection '{COLLECTION_NAME}' not found")
        print(f"   Error: {e}")
        sys.exit(1)


def cmd_status():
    """컬렉션 상태 확인"""
    client = get_client()

    print("=" * 50)
    print("📊 Chroma Status")
    print("=" * 50)
    print(f"📁 Data Directory: {VECTOR_DB_DIR}")

    collections = client.list_collections()
    print(f"\n📚 Collections ({len(collections)}):")

    for col in collections:
        try:
            collection = client.get_collection(col.name)
            count = collection.count()
            print(f"   • {col.name}: {count} documents")
        except:
            print(f"   • {col.name}: (error)")


def cmd_list(limit=10):
    """문서 목록 확인"""
    client = get_client()
    collection = get_collection(client)

    count = collection.count()
    limit = min(limit, count)

    print("=" * 50)
    print(f"📄 Documents (showing {limit} of {count})")
    print("=" * 50)

    if count == 0:
        print("   (no documents)")
        return

    result = collection.peek(limit=limit)

    for i, (id, doc, meta) in enumerate(zip(result['ids'], result['documents'], result['metadatas'])):
        doc_type = meta.get('doc_type', 'unknown')
        session_id = meta.get('session_id', 'unknown')[:8]

        # 타입별 이모지
        emoji = "📝" if doc_type == 'prompt' else "💬" if doc_type == 'response' else "📄"

        print(f"\n{emoji} [{i+1}] {id}")
        print(f"   Type: {doc_type} | Session: {session_id}...")

        # 내용 미리보기 (80자)
        preview = doc[:80].replace('\n', ' ')
        if len(doc) > 80:
            preview += "..."
        print(f"   Content: {preview}")


def cmd_search(query, limit=10):
    """시맨틱 검색"""
    client = get_client()
    collection = get_collection(client)

    print("=" * 50)
    print(f"🔍 Search: \"{query}\"")
    print("=" * 50)

    result = collection.query(
        query_texts=[query],
        n_results=limit
    )

    if not result['ids'][0]:
        print("   (no results)")
        return

    for i, (id, doc, meta, dist) in enumerate(zip(
        result['ids'][0],
        result['documents'][0],
        result['metadatas'][0],
        result['distances'][0]
    )):
        doc_type = meta.get('doc_type', 'unknown')
        # 코사인 거리(0~2)를 유사도(0~1)로 변환
        similarity = max(0, 1 - (dist / 2)) * 100

        emoji = "📝" if doc_type == 'prompt' else "💬" if doc_type == 'response' else "📄"

        print(f"\n{emoji} [{i+1}] {similarity:.1f}% match")
        print(f"   ID: {id}")
        print(f"   Type: {doc_type}")

        # 내용 미리보기
        preview = doc[:100].replace('\n', ' ')
        if len(doc) > 100:
            preview += "..."
        print(f"   Content: {preview}")


def cmd_types():
    """문서 타입별 통계"""
    client = get_client()
    collection = get_collection(client)

    count = collection.count()

    print("=" * 50)
    print("📈 Document Types Statistics")
    print("=" * 50)

    if count == 0:
        print("   (no documents)")
        return

    # 모든 문서의 메타데이터 가져오기
    result = collection.get(include=['metadatas'])

    type_counts = Counter()
    session_counts = Counter()

    for meta in result['metadatas']:
        doc_type = meta.get('doc_type', 'unknown')
        session_id = meta.get('session_id', 'unknown')
        type_counts[doc_type] += 1
        session_counts[session_id] += 1

    print(f"\n📊 By Type (Total: {count}):")
    for doc_type, cnt in type_counts.most_common():
        emoji = "📝" if doc_type == 'prompt' else "💬" if doc_type == 'response' else "📄"
        print(f"   {emoji} {doc_type}: {cnt}")

    print(f"\n📊 By Session (Top 5):")
    for session_id, cnt in session_counts.most_common(5):
        short_id = session_id[:12] + "..." if len(session_id) > 12 else session_id
        print(f"   📁 {short_id}: {cnt} documents")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == 'status':
        cmd_status()
    elif cmd == 'list':
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        cmd_list(limit)
    elif cmd == 'search':
        if len(sys.argv) < 3:
            print("Usage: chroma-cli.py search \"query\"")
            sys.exit(1)
        query = sys.argv[2]
        limit = int(sys.argv[3]) if len(sys.argv) > 3 else 10
        cmd_search(query, limit)
    elif cmd == 'types':
        cmd_types()
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == '__main__':
    main()
