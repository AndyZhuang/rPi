# Two Sum

Given `nums: list[int]` and `target: int`, return the **indices** of two numbers
that add up to `target`. Each input has exactly one solution.

Write `two_sum(nums: list[int], target: int) -> list[int]`.

## Examples

```
two_sum([2, 7, 11, 15], 9) == [0, 1]
two_sum([3, 2, 4], 6) == [1, 2]
```

## Constraints

- `2 <= len(nums) <= 10^4`
- Exactly one valid answer
- Prefer O(n) using a dict; O(n²) is also accepted