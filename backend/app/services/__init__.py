"""
app.services — 通用服务（与 router / worker 解耦）
"""
from .dictionary import lookup, lookup_batch, load_dictionary, get_dict_stats

__all__ = ["lookup", "lookup_batch", "load_dictionary", "get_dict_stats"]