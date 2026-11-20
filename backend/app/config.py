from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://aphelion:aphelion_dev@localhost:5432/aphelion"


settings = Settings()
