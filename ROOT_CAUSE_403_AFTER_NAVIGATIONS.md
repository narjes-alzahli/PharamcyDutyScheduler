# Root Cause: 403 Errors After ~30 Navigations

## Problem
After navigating ~30 times, 403 (Forbidden) errors start appearing, even though the user is a Manager.

## Git History Analysis

### Key Commit: `0b6f1f6` (Nov 13, 2025)
**"Security: Add token revocation/session management - tokens are blacklisted on logout"**

This commit added:
- Token blacklist (`token_blacklist = {}`)
- `cleanup_expired_tokens()` function
- `revoke_token()` function
- `is_token_revoked()` check in `get_current_user()`

## Root Cause Identified

### Issue: Token Refresh Doesn't Revoke Old Token

When a token is refreshed:
1. ✅ New access token is created
2. ✅ New refresh token is created  
3. ❌ **OLD access token is NOT revoked/blacklisted**

### What Happens After Many Navigations:

1. **Initial login** → Token A created (expires in 7 days)
2. **After 7 days** → Token A expires
3. **Token refresh** → Token B created, Token A still valid (not revoked)
4. **Multiple refreshes** → Token C, D, E... created, old tokens still valid
5. **After ~30 navigations** → Multiple tokens exist simultaneously

### The Problem:

The token blacklist only stores tokens that were **explicitly revoked** (on logout). But when tokens are refreshed, the old token is NOT revoked. This means:

- Old tokens remain valid until they naturally expire (7 days)
- Multiple valid tokens can exist for the same user
- After many navigations/refreshes, token state can become inconsistent
- The `employee_type` in old tokens might be stale if user's role changed

### Why 403 Errors?

After many navigations:
1. Frontend might be using an old token (from before refresh)
2. Old token has stale `employee_type` data
3. Backend checks `current_user['employee_type']` from token
4. If token has old role data → 403 error

## Solution

### Fix 1: Revoke Old Token on Refresh

When refreshing a token, the old access token should be revoked:

```python
@router.post("/refresh")
async def refresh_token(...):
    # ... refresh logic ...
    
    # Revoke old access token
    old_token = # get old token from request
    if old_token:
        payload_old = decode_token_without_verification(old_token)
        if payload_old:
            exp_timestamp = payload_old.get("exp")
            if exp_timestamp:
                exp_time = datetime.utcfromtimestamp(exp_timestamp)
                if exp_time > datetime.utcnow():
                    revoke_token(old_token, exp_time)
```

### Fix 2: Always Get Fresh User Data

The refresh endpoint already does this (line 324-336), but we should ensure it's working correctly.

### Fix 3: Clear Token Blacklist Periodically

The blacklist could grow indefinitely. Add periodic cleanup or limit its size.

## Why It Takes ~30 Navigations

- Each navigation might trigger a token refresh (if token is close to expiring)
- After ~30 navigations, you've had multiple token refreshes
- Old tokens accumulate (not revoked)
- Eventually, an old token with stale role data is used
- Backend sees stale role → 403 error

## Immediate Fix Needed

Revoke old access token when refreshing, so only the latest token is valid.

