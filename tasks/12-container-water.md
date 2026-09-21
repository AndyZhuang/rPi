# Container With Most Water

Given `height: list[int]` representing vertical lines, find two lines that
together with the x-axis form a container holding the most water. Return the
max area.

Write `max_water(height: list[int]) -> int`.

## Examples

```
max_water([1, 8, 6, 2, 5, 4, 8, 3, 7]) == 49
max_water([1, 1]) == 1
max_water([4, 3, 2, 1, 4]) == 16
```

## Constraints

- `2 <= len(height) <= 10^5`
- `0 <= height[i] <= 10^4`
- O(n) two-pointer expected