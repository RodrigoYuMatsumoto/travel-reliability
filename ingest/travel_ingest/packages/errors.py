"""Stable error type for the package extractor."""


class PackageError(ValueError):
    """Raised with an upper-case code only; page content is never echoed back."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code
