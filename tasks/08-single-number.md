# Single Number

Every number in `nums` appears twice except one. Find that one.

Write `single_number(nums: list[int]) -> int`.

## Examples

```
single_number([2, 2, 1]) == 1
single_number([4, 1, 2, 1, 2]) == 4
single_number([1]) == 1
```

## Constraints

- `1 <= len(nums) <= 10^4`
- Each element except one appears exactly twice
- O(n) time, O(1) extra space expected (xor trick)