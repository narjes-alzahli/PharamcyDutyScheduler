# Major Restructure: Auth Guard Pattern

## Problem
Components were making API calls (especially manager-only endpoints) **before authentication was fully confirmed**, causing:
- 401 (Unauthorized) errors when tokens weren't ready
- 403 (Forbidden) errors when user role wasn't verified
- Race conditions where components assumed auth state before it was ready

## Root Cause
**Error handling was a bandaid** - the real issue was architectural:
1. Components checked `authLoading === false` but didn't verify the user was actually authenticated
2. Components checked `user?.employee_type === 'Manager'` but this check happened AFTER the API call was queued
3. No centralized guard to prevent API calls until auth is 100% confirmed

## Solution: Auth Guard Hook

Created `useAuthGuard` hook that:
- Waits for `authLoading === false`
- Verifies user is authenticated
- If `requireManager=true`, verifies user is actually a Manager
- Returns `isReady` flag that components MUST check before making API calls

### Implementation

**New File: `frontend/src/hooks/useAuthGuard.ts`**
```typescript
export function useAuthGuard(requireManager: boolean = false): AuthGuardResult {
  // Waits for auth to finish loading
  // Verifies user is authenticated
  // If requireManager, verifies user is Manager
  // Returns isReady flag
}
```

## Changes Made

### 1. UserManagement.tsx
**Before:** Made API calls with defensive checks that could race
```typescript
if (!authLoading && currentUser && currentUser.employee_type === 'Manager') {
  loadRequests(); // Still could race!
}
```

**After:** Uses auth guard - NO API calls until guard confirms ready
```typescript
const { isReady: authReady, isManager } = useAuthGuard(true);

if (authReady && isManager) {
  loadRequests(); // 100% safe - guard confirmed
}
```

### 2. Layout.tsx
**Before:** Made manager-only API calls with manual checks
```typescript
if (!authLoading && user && user.employee_type === 'Manager') {
  fetchPendingRequests(); // Could race!
}
```

**After:** Uses auth guard
```typescript
const { isReady: managerAuthReady, isManager } = useAuthGuard(true);

if (managerAuthReady && isManager) {
  fetchPendingRequests(); // Guard confirmed
}
```

### 3. Component Loading States
**Before:** Components rendered immediately, making calls during render

**After:** Components show loading skeleton until auth guard confirms ready
```typescript
if (authLoading || !authReady) {
  return <LoadingSkeleton />; // Prevents any API calls
}
```

## Why This Works

1. **Single Source of Truth**: Auth guard is the ONLY place that determines if API calls are safe
2. **No Race Conditions**: Components can't make calls until guard explicitly says "ready"
3. **Type Safety**: If `isReady=true` and `requireManager=true`, we KNOW user is Manager
4. **Prevents Premature Calls**: Loading state blocks rendering until guard confirms

## Testing

After hard refresh, you should see:
- ✅ No 401 errors (auth guard waits for token verification)
- ✅ No 403 errors (auth guard confirms Manager status before calls)
- ✅ Smooth loading (components show skeleton until ready)

## Next Steps

If you still see errors, check:
1. Are all manager-only components using `useAuthGuard(true)`?
2. Are components checking `isReady` before making API calls?
3. Is the auth guard hook correctly waiting for `authLoading === false`?

