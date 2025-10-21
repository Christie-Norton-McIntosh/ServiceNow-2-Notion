# AutoExtract Access Limited Handling - Flow Diagrams

## Overall Process Flow

```
START AutoExtract
         │
         ▼
┌─────────────────────┐
│  Load Page N        │
└────────┬────────────┘
         │
         ▼
    ┌─────────────┐
    │ STEP 0:     │
    │ Check for   │
    │ Access      │
    │ Limited?    │
    └─────┬──────┘
          │
     NO   │   YES
   ┌──────┘   └────┐
   │               │
   ▼               ▼
 STEP 1:    ┌──────────────────┐
 Check      │ Reload Attempt   │
 for 503    │ 1 of 3 (15sec)   │
   │        └────────┬─────────┘
   │                 │
   │                 ▼
   │        ┌────────────────────┐
   │        │ Check: Still       │
   │        │ Access Limited?    │
   │        └─────┬──────────┬───┘
   │           YES│          │NO
   │           ┌──▼──────────▼──┐
   │           │ Retry left?    │
   │           │ (2, 3...)      │
   │           └───┬────────┬───┘
   │            YES│        │NO
   │            ┌──▼──┐  ┌──▼──────────────────┐
   │            │Wait │  │ Access Recovered!   │
   │            │5sec │  │ Extract & Save      │
   │            └──┬──┘  └────────┬───────────┘
   │               │              │
   │          ┌────▼────┐         │
   │          │Retry... │         │
   │          └────┬────┘         │
   │               │              │
   │     ┌─────────┴──────────────┴──┐
   │     │                           │
   │     ▼                           ▼
   │ ┌─────────────┐         ┌───────────┐
   │ │ Still       │         │ SUCCESS!  │
   │ │ Limited?    │         │ Next page │
   │ │ All retries │         └─────┬─────┘
   │ │ exhausted?  │               │
   │ └──────┬──────┘               │
   │        │                      │
   │     YES│                      │
   │        │                      │
   │        ▼                      │
   │   ┌───────────┐               │
   │   │ SKIP PAGE │               │
   │   │ (No Save) │               │
   │   └─────┬─────┘               │
   │         │                     │
   │    ┌────▼─────────────┐       │
   │    │ Find Next Button │       │
   │    │ & Navigate       │       │
   │    └────┬─────────────┘       │
   │         │                     │
   └─────────┴─────────┬───────────┘
             │         │
             ▼         ▼
        ┌──────────────────┐
        │ Continue to Next │
        │ Page             │
        └────────┬─────────┘
                 │
         ┌───────▼───────┐
         │ Max pages     │
         │ reached?      │
         └───┬───────┬───┘
            NO      YES
             │       │
             │       ▼
             │    ┌────────┐
             │    │ FINISH │
             │    └────────┘
             │
             ▼
        Load Next Page
             │
             ▼
         (back to STEP 0)
```

## Reload + Skip Logic Details

```
╔════════════════════════════════════════════════════════════╗
║  STEP 0: Access Limited Detection & Recovery             ║
╚════════════════════════════════════════════════════════════╝

Start
  │
  ▼
╔──────────────────────────────────────────────────────────╗
║ isPageAccessLimited()?                                   ║
║ Check: Page title = "Access to this..."                 ║
║ or h1 contains message?                                  ║
╚────────┬───────────────────────────────────────────┬─────╝
      YES│                                           │NO
         │                                      Goes to
         ▼                                      STEP 1
╔──────────────────────────────────────────────────────────╗
║ Initialize Reload Attempts = 0                           ║
║ Max Reload Attempts = 3                                  ║
╚────────┬────────────────────────────────────────────────┘
         │
         ▼
    ╔─────────────────────────────────────────────────────╗
    ║ WHILE (isPageAccessLimited() AND attempts < 3)     ║
    ╚──────┬──────────────────────────────────────────────┘
           │
           ▼
    ┌───────────────────────────────────────────────────┐
    │ attempts++                                        │
    │ Show toast: "Reloading (attempt X/3)..."         │
    │ Update button text: "Reloading for access..."    │
    └───────────┬───────────────────────────────────────┘
                │
                ▼
    ┌───────────────────────────────────────────────────┐
    │ Call: reloadAndWait(15000)                        │
    │ - Reload page                                    │
    │ - Wait up to 15 seconds for load                │
    │ - Check if content stabilized                   │
    └───────────┬───────────────────────────────────────┘
                │
                ▼
    ┌───────────────────────────────────────────────────┐
    │ Reload success?                                  │
    └──┬──────────────────────────────────────┬────────┘
      NO                                     YES
       │                                     │
       ▼                                     │
    ┌─────────────────┐                    │
    │ More retries?   │                    │
    └───┬──────┬──────┘                    │
      NO│     YES│                        │
        │        │                         │
        │        ▼                         │
        │   ┌──────────┐                  │
        │   │ Wait 5s  │                  │
        │   │ (before  │                  │
        │   │ retry)   │                  │
        │   └────┬─────┘                  │
        │        │                        │
        │   ┌────▼─────────────────────┐ │
        │   │ Loop back to check       │ │
        │   │ isPageAccessLimited()    │ │
        │   │ again                    │ │
        │   └────────────────────────┬─┘ │
        │                            │   │
        ▼                            ▼   │
    ┌───────────────────────────────────▼──────────┐
    │ After loop: Check isPageAccessLimited()      │
    └──┬─────────────────────────┬──────────────────┘
      NO                       YES
       │                        │
       │                        ▼
       │              ┌────────────────────────┐
       │              │ Still Limited!         │
       │              │ (after all retries)    │
       │              └──────────┬─────────────┘
       │                         │
       │                         ▼
       │              ┌────────────────────────┐
       │              │ SKIP THIS PAGE         │
       │              │ - Don't save to Notion │
       │              │ - Find next button     │
       │              │ - Navigate next page   │
       │              │ - Show toast: "Skipped"│
       │              └──────────┬─────────────┘
       │                         │
       ▼                         ▼
    ┌─────────────────────────────────────────┐
    │ Extract & Save to Notion     OR          │
    │                                          │
    │ Skip & Navigate to Next                 │
    └──────────────┬───────────────────────────┘
                   │
                   ▼
              Continue loop...
```

## Timeline Example: Reload Then Skip

```
Timeline for Access Limited Page Processing:

00:00 ─ Page 5 loaded
         └─ Detected: "Access to this content is limited..."
         
00:01 ─ Reload Attempt 1 triggered
        Show: "⚠️ Page access limited, reloading (attempt 1/3)..."
        
00:15 ─ Reload 1 complete, 15 second timeout
        Check: Still limited? YES
        
01:16 ─ Wait 5 seconds before retry
        
01:21 ─ Reload Attempt 2 triggered
        Show: "⚠️ Page access limited, reloading (attempt 2/3)..."
        
01:36 ─ Reload 2 complete, 15 second timeout
        Check: Still limited? YES
        
01:37 ─ Wait 5 seconds before retry
        
01:42 ─ Reload Attempt 3 triggered
        Show: "⚠️ Page access limited, reloading (attempt 3/3)..."
        
01:57 ─ Reload 3 complete, 15 second timeout
        Check: Still limited? YES ✗
        
01:58 ─ All reloads exhausted
        Decision: SKIP THIS PAGE
        Show: "⊘ Skipped page 5: Access limited (after 3 reloads)"
        
02:00 ─ Find next page button
        Show: "🔍 Finding next page button after skip..."
        
02:02 ─ Next button found
        Show: "✅ Found next page button after skip"
        
02:03 ─ Click next button
        Show: "👆 Clicking next page button..."
        
02:05 ─ Navigation detected
        Show: "✅ Navigation detected! Page 6 loaded"
        
02:08 ─ Page 6 loaded and ready
        Back to STEP 0 for Page 6...

Total time for skipped page: ~2 minutes (reload attempts)
Total time for recovered page: ~15-20 seconds (1 reload + extraction)
```

## Multi-Page Extraction Timeline

```
Page Processing Sequence:

Page 1: Load → Check → No issue → Extract → Save ✅ (20s)
              ↓
Page 2: Load → Check → Limited → Reload 1 → Still limited
              ↓ Reload 2 → Still limited → Reload 3 → Still limited
              ↓ Skip, Find button → Navigate (120s)
              ↓
Page 3: Load → Check → No issue → Extract → Save ✅ (20s)
              ↓
Page 4: Load → Check → No issue → Extract → Save ✅ (20s)
              ↓
Page 5: Load → Check → Limited → Reload 1 → Access regained!
              ↓ Extract → Save ✅ (35s)
              ↓
Page 6: Load → Check → Limited → Reload 1 → Still limited
              ↓ Reload 2 → Still limited → Reload 3 → Still limited
              ↓ Skip, Find button → Navigate (120s)
              ↓
Page 7: Load → Check → No issue → Extract → Save ✅ (20s)

Results:
├─ Saved: Pages 1, 2 (recovered), 3, 4, 5 (recovered), 7 = 5 pages
├─ Skipped: Pages 2, 6 = 2 pages (access limited)
└─ Total time: ~275 seconds (~5 minutes for 7 pages)
```

## Decision Tree: What Happens to Each Page

```
                          Page Loaded
                              │
                    ┌─────────▼──────────┐
                    │  Access Limited    │
                    │  Check             │
                    └─────────┬──────────┘
                          ┌───┴────┐
                       YES│        │NO
                          │        │
                   ┌──────▼─┐   ┌──▼───────────┐
                   │ Reload │   │ Check for    │
                   │ 1/3    │   │ 503 error    │
                   └────┬───┘   └──┬───────────┘
                        │          │
                 ┌──────▼──────┐   │
                 │  Still      │   │
                 │  Limited?   │   │
                 └────┬────────┘   │
                    NO│YES        │
                    ┌─▼──┐   ┌────▼─────┐
                    │OK! │   │ Reload   │
                    │→  │   │ 2/3      │
                    │Extract│   └────┬───┘
                    │Save  │        │
                    └─────┘   ┌─────▼──────┐
                             │  Still     │
                             │ Limited?   │
                             └──┬─────────┘
                              NO│YES
                              ┌─▼──┐   ┌─────────┐
                              │OK! │   │ Reload  │
                              │→  │   │ 3/3     │
                              │Extract│   └────┬──┘
                              │Save  │        │
                              └──┬──┘   ┌─────▼──────┐
                                 │      │  Still     │
                                 │      │ Limited?   │
                                 │      └─┬────────┬─┘
                                 │     NO │       YES
                                 │      ┌─▼──┐   ┌──▼─────┐
                                 │      │OK! │   │ SKIP   │
                                 │      │→  │   │ PAGE   │
                                 │      │Extract│   Navigate
                                 │      │Save  │   Next
                                 │      └─────┘   └──┬─────┘
                                 │                   │
                                 ├──────────────────┤
                                 │                  │
                         ✅ Saved to Notion    ⊘ Skipped
```

## State Machine: Page Processing States

```
[INITIAL]
    │
    ▼
[LOADING PAGE] ←─────────────────────────────────┐
    │                                             │
    ├─ Timeout/Error → [ERROR] → STOP           │
    │                                             │
    ▼                                             │
[CHECK: ACCESS LIMITED?]                         │
    │                                             │
    ├─ NO → [CHECK: 503 ERROR?]                 │
    │            │                               │
    │            ├─ NO → [EXTRACT CONTENT]      │
    │            │            │                  │
    │            │            ▼                  │
    │            │      [SAVE TO NOTION]        │
    │            │            │                  │
    │            │            ▼                  │
    │            │      [SUCCESS] ✅             │
    │            │                               │
    │            ├─ YES → [RELOAD: 503]         │
    │                     │                      │
    │                     ▼                      │
    │             [NAVIGATE TO NEXT] ───┐        │
    │                                   │        │
    │                                   └────────┤
    │                                             │
    └─ YES → [RELOAD ATTEMPT 1/3]              │
             │                                  │
             ├─ Still limited? → [RELOAD 2/3]  │
             │                   │               │
             │                   ├─ Still? → [RELOAD 3/3]
             │                   │   │           │
             │                   │   │           ├─ Still? → [SKIP PAGE] ⊘
             │                   │   │           │              │
             │                   │   │           └──────────────┘
             │                   │   │
             │                   │   └─ Not limited? → [EXTRACT] ✅
             │                   │
             │                   └─ Not limited? → [EXTRACT] ✅
             │
             └─ Not limited? → [EXTRACT CONTENT]
                                │
                                ▼
                          [SAVE TO NOTION] ✅
```

---

These diagrams show:
1. Overall flow from start to finish
2. Detailed reload + skip logic
3. Timeline example with seconds
4. Multi-page extraction sequence
5. Decision tree for page outcomes
6. State machine showing all possible states

