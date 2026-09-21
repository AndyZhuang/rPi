# LRU Cache

Design a Least Recently Used cache class with O(1) get and put.

Implement:

```python
class LRUCache:
    def __init__(self, capacity: int): ...
    def get(self, key: int) -> int: ...        # return value or -1
    def put(self, key: int, value: int) -> None: ...
```

## Examples

```
c = LRUCache(2)
c.put(1, 1); c.put(2, 2)
c.get(1) == 1
c.put(3, 3)                  # evicts key 2
c.get(2) == -1
c.get(3) == 3
c.put(4, 4)                  # evicts key 1
c.get(1) == -1
c.get(3) == 3
c.get(4) == 4
```

## Constraints

- `1 <= capacity <= 3000`
- `0 <= key, value <= 10^4`
- At most `2 * 10^5` calls to get/put
- O(1) per operation required