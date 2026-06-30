"""
词库管理路由（task #36 加 JWT 鉴权）

- 所有端点需要 JWT（get_current_account Depends）
- 兼容老 query ?user_id=xxx：写入时 mirror 到 account_id（仅向后兼容，老前端不会调用）
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import auth as auth_core
from ..database import get_db
from ..models import Account, Library, Word
from ..schemas import LibraryCreate, LibraryResponse, WordAddRequest, WordAddResponse
from ..workers.lemma import lemmatize_word

router = APIRouter()
logger = logging.getLogger(__name__)


WORDS_PER_LEVEL = 50  # 与前端 librariesManager.WORDS_PER_LEVEL_CUSTOM 一致


def _calc_level_count(word_count: int) -> int:
    return max(1, (word_count + WORDS_PER_LEVEL - 1) // WORDS_PER_LEVEL)


def _resolve_owner_library(
    library_id: str,
    account: Account,
    db: Session,
) -> Library:
    """校验 library 属于当前账号；找不到/不属于都抛 404（不泄露存在性）"""
    lib = db.query(Library).filter(Library.id == library_id).first()
    if not lib:
        raise HTTPException(status_code=404, detail="词库不存在")
    # 优先 account_id；老 user_id 也允许
    if lib.account_id and lib.account_id != account.id:
        raise HTTPException(status_code=403, detail="无权访问此词库")
    return lib


@router.post("/libraries", response_model=LibraryResponse, status_code=201)
def create_library(
    payload: LibraryCreate,
    account: Account = Depends(auth_core.get_current_account),
    db: Session = Depends(get_db),
):
    """创建自定义词库（归属当前账号 + 当前玩家档案）"""
    # 防重名（account_id 维度）
    existing = db.query(Library).filter(
        Library.account_id == account.id, Library.name == payload.name
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"词库「{payload.name}」已存在")

    lib = Library(
        account_id=account.id,
        user_id=account.id,        # mirror 到 legacy 列，老前端查询也能命中
        name=payload.name,
        source=payload.source,
        is_default=False,
        word_count=0,
        level_count=1,
    )
    db.add(lib)
    db.commit()
    db.refresh(lib)
    return lib


@router.get("/libraries", response_model=List[LibraryResponse])
def list_libraries(
    account: Account = Depends(auth_core.get_current_account),
    db: Session = Depends(get_db),
):
    """列出当前账号的所有词库（按创建时间排序）"""
    libs = (
        db.query(Library)
        .filter(Library.account_id == account.id)
        .order_by(Library.created_at)
        .all()
    )
    return libs


@router.get("/libraries/{library_id}", response_model=LibraryResponse)
def get_library(
    library_id: str,
    account: Account = Depends(auth_core.get_current_account),
    db: Session = Depends(get_db),
):
    return _resolve_owner_library(library_id, account, db)


@router.delete("/libraries/{library_id}", status_code=204)
def delete_library(
    library_id: str,
    account: Account = Depends(auth_core.get_current_account),
    db: Session = Depends(get_db),
):
    lib = _resolve_owner_library(library_id, account, db)
    if lib.is_default:
        raise HTTPException(status_code=403, detail="默认词库不可删除")
    db.delete(lib)
    db.commit()
    return None


@router.post("/libraries/{library_id}/words", response_model=WordAddResponse)
def add_words(
    library_id: str,
    payload: WordAddRequest,
    lemmatize: bool = Query(True, description="是否对单词做词形还原（books→book）"),
    account: Account = Depends(auth_core.get_current_account),
    db: Session = Depends(get_db),
):
    """
    批量添加单词到词库（去重，按 position 追加）
    - 跳过已存在（按 word 不区分大小写）
    - 新词追加到末尾
    - level_count 自动重算
    - 默认对单词做词形还原（phrase 不还原），可通过 ?lemmatize=false 关闭
    """
    lib = _resolve_owner_library(library_id, account, db)
    if lib.is_default:
        raise HTTPException(status_code=403, detail="默认词库只读")

    existing_words = {w.word.lower() for w in lib.words}
    existing_count = len(existing_words)
    added = 0
    skipped = 0
    next_position = existing_count

    for item in payload.words:
        word = item.get("word", "").strip()
        meaning = item.get("meaning", "").strip()
        if not word:
            skipped += 1
            continue
        if lemmatize:
            normalized = lemmatize_word(word)
            if normalized and normalized != word:
                logger.debug(f"lemma: {word!r} → {normalized!r}")
            word = normalized or word
        if word.lower() in existing_words:
            skipped += 1
            continue
        w = Word(
            library_id=library_id,
            word=word,
            meaning=meaning,
            difficulty=item.get("difficulty", 5),
            position=next_position,
            audio_en=item.get("audio_en", ""),
            audio_zh=item.get("audio_zh", ""),
        )
        db.add(w)
        existing_words.add(word.lower())
        next_position += 1
        added += 1

    lib.word_count = next_position
    lib.level_count = _calc_level_count(lib.word_count)
    db.commit()

    return WordAddResponse(added=added, skipped=skipped, total=lib.word_count)


@router.get("/libraries/{library_id}/words")
def get_words(
    library_id: str,
    account: Account = Depends(auth_core.get_current_account),
    db: Session = Depends(get_db),
):
    lib = _resolve_owner_library(library_id, account, db)
    return [
        {
            "id": w.id,
            "word": w.word,
            "meaning": w.meaning,
            "difficulty": w.difficulty,
            "position": w.position,
            "audio_en": w.audio_en,
            "audio_zh": w.audio_zh,
        }
        for w in sorted(lib.words, key=lambda x: x.position)
    ]
