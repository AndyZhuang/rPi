def length_of_longest_substring(s: str) -> int:
    left = 0
    max_len = 0
    char_index = {}
    for right, ch in enumerate(s):
        if ch in char_index:
            left = max(left, char_index[ch] + 1)
        char_index[ch] = right
        max_len = max(max_len, right - left + 1)
    return max_len