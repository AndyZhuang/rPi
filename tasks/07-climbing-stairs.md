# Climbing Stairs

You are climbing a staircase. It takes `n` steps to reach the top. Each move you
can take 1 or 2 steps. In how many distinct ways can you climb to the top?

Write `climb_stairs(n: int) -> int`.

## Examples

```
climb_stairs(2) == 2     # 1+1, 2
climb_stairs(3) == 3     # 1+1+1, 1+2, 2+1
climb_stairs(1) == 1
```

## Constraints

- `1 <= n <= 45`
- Result fits in 32-bit int (Fibonacci sequence)