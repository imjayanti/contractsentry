from fastapi import APIRouter  # ty: ignore[unresolved-import]

router = APIRouter()

# DRIFT: missing `email` field — spec requires id + name + email
@router.get("/users/{user_id}")
async def get_user(user_id: int):
    return {"id": user_id, "name": "Alice"}

@router.get("/users")
async def list_users():
    return [{"id": 1, "name": "Alice", "email": "alice@example.com"}]

# DRIFT: id is string (should be integer), email is missing
@router.post("/users")
async def create_user(name: str, email: str):
    return {"id": "1", "name": name}

# csentry-ignore
@router.delete("/users/{user_id}")
async def delete_user(user_id: int):
    return {"deleted": user_id}
