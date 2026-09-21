"""
Canonical asserts for every benchmark task.

`grader.py` imports this module to validate candidate solutions.
Each test_<id>() runs the candidate's function and asserts correctness.

A candidate solution is a Python source string that defines functions matching
the task's expected signature (e.g., `fizzbuzz(n)` for task 01).
"""

from typing import Callable, Any


# ---------- 01 FizzBuzz ----------

def run_01(sol: Callable[[int], list]):
    assert sol(5) == ["1", "2", "Fizz", "4", "Buzz"], f"got {sol(5)}"
    assert sol(15) == ["1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz", "11", "Fizz", "13", "14", "FizzBuzz"], f"got {sol(15)}"
    assert sol(1) == ["1"], f"got {sol(1)}"
    assert sol(3) == ["1", "2", "Fizz"], f"got {sol(3)}"


# ---------- 02 Two Sum ----------

def run_02(sol: Callable[[list, int], list]):
    assert sol([2, 7, 11, 15], 9) == [0, 1]
    assert sol([3, 2, 4], 6) == [1, 2]
    assert sol([3, 3], 6) == [0, 1]
    assert sol([1, 5, 5, 5, 9], 10) == [1, 2]


# ---------- 03 Reverse String ----------

def run_03(sol: Callable[[str], str]):
    assert sol("hello") == "olleh"
    assert sol("") == ""
    assert sol("a") == "a"
    assert sol("ab") == "ba"
    assert sol("racecar") == "racecar"


# ---------- 04 Palindrome Number ----------

def run_04(sol: Callable[[int], bool]):
    assert sol(121) is True
    assert sol(-121) is False
    assert sol(10) is False
    assert sol(0) is True
    assert sol(12321) is True
    assert sol(1234) is False


# ---------- 05 Binary Search ----------

def run_05(sol: Callable[[list, int], int]):
    assert sol([1, 3, 5, 7, 9], 5) == 2
    assert sol([1, 3, 5, 7, 9], 4) == -1
    assert sol([], 0) == -1
    assert sol([5], 5) == 0
    assert sol([1, 2, 3, 4, 5], 1) == 0
    assert sol([1, 2, 3, 4, 5], 5) == 4


# ---------- 06 Valid Parentheses ----------

def run_06(sol: Callable[[str], bool]):
    assert sol("()") is True
    assert sol("()[]{}") is True
    assert sol("(]") is False
    assert sol("([)]") is False
    assert sol("{[]}") is True
    assert sol("") is True
    assert sol("(((") is False
    assert sol(")))") is False


# ---------- 07 Climbing Stairs ----------

def run_07(sol: Callable[[int], int]):
    assert sol(1) == 1
    assert sol(2) == 2
    assert sol(3) == 3
    assert sol(4) == 5
    assert sol(5) == 8
    assert sol(10) == 89


# ---------- 08 Single Number ----------

def run_08(sol: Callable[[list], int]):
    assert sol([2, 2, 1]) == 1
    assert sol([4, 1, 2, 1, 2]) == 4
    assert sol([1]) == 1
    assert sol([0, 1, 0]) == 1


# ---------- 09 Maximum Subarray ----------

def run_09(sol: Callable[[list], int]):
    assert sol([-2, 1, -3, 4, -1, 2, 1, -5, 4]) == 6
    assert sol([5, 4, -1, 7, 8]) == 23
    assert sol([1]) == 1
    assert sol([-1]) == -1
    assert sol([1, -1, 1, -1, 1]) == 1
    assert sol([-1, -2, -3]) == -1


# ---------- 10 Merge Two Sorted Lists ----------

def run_10(sol: Callable[[list, list], list]):
    assert sol([1, 3, 5], [2, 4, 6]) == [1, 2, 3, 4, 5, 6]
    assert sol([], [1, 2]) == [1, 2]
    assert sol([1], []) == [1]
    assert sol([], []) == []
    assert sol([1], [2]) == [1, 2]
    assert sol([1, 2, 3], []) == [1, 2, 3]


# Registry of (id -> runner). Functions are referenced by name in the candidate.

RUNNERS = {
    "01": run_01,
    "02": run_02,
    "03": run_03,
    "04": run_04,
    "05": run_05,
    "06": run_06,
    "07": run_07,
    "08": run_08,
    "09": run_09,
    "10": run_10,
}


# For each task, the expected function name (pi should define exactly this).
EXPECTED_FN = {
    "01": "fizzbuzz",
    "02": "two_sum",
    "03": "reverse_string",
    "04": "is_palindrome",
    "05": "binary_search",
    "06": "is_valid_parentheses",
    "07": "climb_stairs",
    "08": "single_number",
    "09": "max_subarray",
    "10": "merge_lists",
}