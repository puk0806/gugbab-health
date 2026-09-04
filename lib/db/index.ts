import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from "idb";
import { openDB } from "idb";
import type { BodyMetric, Conversation, Ingredient, LegacyMealHistory, UserProfile } from "./types";

interface HealthDB extends DBSchema {
    userProfile: {
        key: string;
        value: UserProfile;
    };
    ingredients: {
        key: string;
        value: Ingredient;
        indexes: { byAddedAt: string };
    };
    bodyMetrics: {
        key: string;
        value: BodyMetric;
        indexes: { byDate: string };
    };
    conversations: {
        key: string;
        value: Conversation;
        indexes: { byUpdatedAt: string };
    };
}

export function getLocalDateString(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function deriveConversationTitle(messages: Conversation["messages"]): string {
    const firstUser = messages.find((m) => m.role === "user");
    if (!firstUser) return "새 대화";
    const trimmed = firstUser.content.trim();
    return trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed;
}

/** v1 mealHistory(하루 1건) 레코드를 v2 대화방으로 이관 */
async function migrateMealHistoryToConversations(
    db: IDBPDatabase<HealthDB>,
    tx: IDBPTransaction<HealthDB, StoreNames<HealthDB>[], "versionchange">,
): Promise<void> {
    // 구 스토어는 현행 스키마 타입에 없음 — 마이그레이션 경계에서만 타입 우회 접근
    const legacyStore = (tx.objectStore as unknown as (name: string) => { getAll(): Promise<LegacyMealHistory[]> })(
        "mealHistory",
    );
    const rows = await legacyStore.getAll();
    const convStore = tx.objectStore("conversations");
    for (const h of rows) {
        if (!h.messages || h.messages.length === 0) continue;
        await convStore.put({
            id: h.id,
            title: deriveConversationTitle(h.messages),
            messages: h.messages,
            createdAt: h.createdAt || `${h.date}T00:00:00.000Z`,
            updatedAt: h.updatedAt || `${h.date}T00:00:00.000Z`,
        });
    }
    db.deleteObjectStore("mealHistory" as never);
}

const DB_NAME = "gugbab-health";
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<HealthDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<HealthDB>> {
    if (!dbPromise) {
        dbPromise = openDB<HealthDB>(DB_NAME, DB_VERSION, {
            async upgrade(db, _oldVersion, _newVersion, tx) {
                if (!db.objectStoreNames.contains("userProfile")) {
                    db.createObjectStore("userProfile", { keyPath: "id" });
                }

                if (!db.objectStoreNames.contains("ingredients")) {
                    const ingredientStore = db.createObjectStore("ingredients", {
                        keyPath: "id",
                    });
                    ingredientStore.createIndex("byAddedAt", "addedAt");
                }

                if (!db.objectStoreNames.contains("bodyMetrics")) {
                    const metricStore = db.createObjectStore("bodyMetrics", {
                        keyPath: "id",
                    });
                    metricStore.createIndex("byDate", "date");
                }

                if (!db.objectStoreNames.contains("conversations")) {
                    const convStore = db.createObjectStore("conversations", {
                        keyPath: "id",
                    });
                    convStore.createIndex("byUpdatedAt", "updatedAt");
                }

                // v1 → v2: 하루 1건 mealHistory를 대화방으로 이관 후 구 스토어 제거
                if (db.objectStoreNames.contains("mealHistory" as never)) {
                    await migrateMealHistoryToConversations(db, tx);
                }

                // v2 → v3: 식재료 카테고리 폐지 — 인덱스 제거.
                // 기존 레코드의 category 값은 읽지 않으므로 그대로 두어도 무해하다
                if (db.objectStoreNames.contains("ingredients")) {
                    const store = tx.objectStore("ingredients");
                    if (store.indexNames.contains("byCategory" as never)) {
                        store.deleteIndex("byCategory" as never);
                    }
                }
            },
        }).catch((err: unknown) => {
            dbPromise = null;
            throw err;
        });
    }
    return dbPromise;
}
