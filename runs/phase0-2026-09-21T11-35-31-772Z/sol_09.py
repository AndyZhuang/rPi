def max_subarray(nums: list[int]) -> int:
    max_ending_here = max_sofar = nums[0]
    for num in nums[1:]:
        max_ending_here = max(num, max_ending_here + num)
        max_sofar = max(max_sofar, max_ending_here)
    return max_sofar