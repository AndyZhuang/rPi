# FizzBuzz

Write a function `fizzbuzz(n: int) -> list[str]` that returns a list of strings
from 1 to n (inclusive), where:
- multiples of 3 → "Fizz"
- multiples of 5 → "Buzz"
- multiples of both → "FizzBuzz"
- everything else → the number as a string

## Examples

```
fizzbuzz(5) == ["1", "2", "Fizz", "4", "Buzz"]
fizzbuzz(15)[-1] == "FizzBuzz"
```

## Constraints

- `1 <= n <= 1000`
- Return a list, not print