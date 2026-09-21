# Maximum Subarray

Find the contiguous subarray with the largest sum.

Write `max_subarray(nums: list[int]) -> int`.

## Examples

```
max_subarray([-2, 1, -3, 4, -1, 2, 1, -5, 4]) == 6   # [4, -1, 2, 1]
max_subarray([5, 4, -1, 7, 8]) == 23
max_subarray([1]) == 1
max_subarray([-1]) == -1
```

## Constraints

- `1 <= len(nums) <= 10^5`
- Kadane's algorithm O(n) expected; O(n²) accepted but slow on max size