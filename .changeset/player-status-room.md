---
"@assesskit/player": major
---

The status lines keep their room whether or not they hold text, so that writing a message moves nothing. `mountDelivery` and `mountItem` wrote "Answers saved." about 50 ms after an answer into a line that took no room while it was empty, which moved a button after the player down by about 40 px; a learner who pressed that button as the line appeared, as a person's press lasting about 100 ms can, got no click, because the browser sends a click only when the pointer is released over the element it was pressed on. The line of the timer warnings of `mountDelivery` keeps its room as well, from the first view that shows a timer, so that a warning does not move the item and its actions; a test with no timer has none. A line stays announced as before (`role="status"`, `aria-live="polite"`).
