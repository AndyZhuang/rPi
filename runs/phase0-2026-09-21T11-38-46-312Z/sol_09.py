def max_subarray(nums):
    if not nums:
        return 0
    current = best = nums[0]
    for num in nums[1:]:
        current = max(num, current + num)
        best = max(best, current)
    return best