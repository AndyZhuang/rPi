# Trapping Rain Water

Given `height: list[int]` representing elevations, compute how much water is
trapped after raining.

Write `trap_rain(height: list[int]) -> int`.

## Examples

```
trap_rain([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]) == 6
trap_rain([4, 2, 0, 3, 2, 5]) == 9
trap_rain([1, 0, 1]) == 1
trap_rain([]) == 0
trap_rain([3, 0, 0, 2, 0, 4]) == 10
```

## Constraints

- `0 <= len(height) <= 10^5`
- `0 <= height[i] <= 10^5`
- O(n) two-pointer or stack expected