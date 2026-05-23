"""
Base classes and mixins for data models.
"""

from typing import Any, Callable, Dict, List, Optional
from dataclasses import asdict


class DataclassJsonMixin:
    """
    A mixin that provides methods for converting dataclasses to dictionaries or JSON.
    This is used to standardize the conversion of dataclasses to dictionaries for JSON serialization.
    """

    def to_dict(
        self,
        included_keys: Optional[List[str]] = None,
        excluded_keys: Optional[List[str]] = None,
        key_names_mapping: Optional[Dict[str, str]] = None,
        key_values_mapping: Optional[Dict[str, Callable[[Any], Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Convert the dataclass instance to a dictionary with flexible customization options.

        Args:
            included_keys: Only include these keys in the output. If None, all keys are included
                (except those in excluded_keys).
            excluded_keys: Exclude these keys from the output. Only used if included_keys is None.
            key_names_mapping: Map old key names to new key names.
            key_values_mapping: Map keys to functions that transform their values.

        Returns:
            Dict representation of the dataclass instance.
        """
        # Start with the full dictionary from asdict()
        result = asdict(self)

        # Filter by included_keys if specified
        if included_keys is not None:
            result = {k: v for k, v in result.items() if k in included_keys}
        # Otherwise, filter by excluded_keys
        elif excluded_keys is not None:
            result = {k: v for k, v in result.items() if k not in excluded_keys}

        # Transform values if key_values_mapping is provided
        if key_values_mapping is not None:
            for key, transform_func in key_values_mapping.items():
                if key in result:
                    result[key] = transform_func(result[key])

        # Rename keys if key_names_mapping is provided
        if key_names_mapping is not None:
            for old_key, new_key in key_names_mapping.items():
                if old_key in result:
                    result[new_key] = result.pop(old_key)

        return result

    @classmethod
    def list_to_dict_list(
        cls,
        instances: List["DataclassJsonMixin"],
        included_keys: Optional[List[str]] = None,
        excluded_keys: Optional[List[str]] = None,
        key_names_mapping: Optional[Dict[str, str]] = None,
        key_values_mapping: Optional[Dict[str, Callable[[Any], Any]]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Convert a list of dataclass instances to a list of dictionaries.

        Args:
            instances: List of dataclass instances.
            included_keys: Only include these keys in the output. If None, all keys are included
                (except those in excluded_keys).
            excluded_keys: Exclude these keys from the output. Only used if included_keys is None.
            key_names_mapping: Map old key names to new key names.
            key_values_mapping: Map keys to functions that transform their values.

        Returns:
            List of dictionaries representing the dataclass instances.
        """
        return [
            instance.to_dict(
                included_keys=included_keys,
                excluded_keys=excluded_keys,
                key_names_mapping=key_names_mapping,
                key_values_mapping=key_values_mapping,
            )
            for instance in instances
        ]
