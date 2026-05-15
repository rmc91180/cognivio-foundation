import importlib


def test_create_app_is_idempotent_for_metrics_route():
    app_main = importlib.import_module("app.main")

    app_one = app_main.create_app()
    metrics_count_after_first = sum(1 for route in app_one.routes if getattr(route, "path", None) == "/metrics")

    app_two = app_main.create_app()
    metrics_count_after_second = sum(1 for route in app_two.routes if getattr(route, "path", None) == "/metrics")

    assert app_one is app_two
    assert metrics_count_after_first == 1
    assert metrics_count_after_second == 1


def test_extracted_routers_are_registered_but_unmounted_until_cutover():
    routers = importlib.import_module("app.routers").REGISTERED_ROUTERS
    statuses = {item["name"]: item["status"] for item in routers}

    assert statuses["legacy_api_router"] == "bridged"
    assert statuses["auth_router"] == "extracted_unmounted"
    assert statuses["videos_router"] == "extracted_unmounted"
