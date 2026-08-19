"use client";

import { useEffect, useState } from "react";
import BottomNav from "@/components/layout/BottomNav";
import { addIngredient, deleteIngredient, getAllIngredients } from "@/lib/db/ingredients";
import type { Ingredient } from "@/lib/db/types";
import styles from "./page.module.css";

export default function IngredientsPage() {
    const [items, setItems] = useState<Ingredient[]>([]);
    const [loadingItems, setLoadingItems] = useState(true);
    const [name, setName] = useState("");
    const [adding, setAdding] = useState(false);

    useEffect(() => {
        getAllIngredients()
            .then((fetched) => {
                setItems((current) => {
                    const fetchedIds = new Set(fetched.map((i) => i.id));
                    const pendingAdds = current.filter((i) => !fetchedIds.has(i.id));
                    return [...fetched, ...pendingAdds];
                });
            })
            .finally(() => setLoadingItems(false));
    }, []);

    async function handleAdd() {
        const trimmed = name.trim();
        if (!trimmed) return;
        setAdding(true);
        try {
            const item = await addIngredient(trimmed);
            setItems((prev) => [...prev, item]);
            setName("");
        } finally {
            setAdding(false);
        }
    }

    async function handleDelete(id: string) {
        await deleteIngredient(id);
        setItems((prev) => prev.filter((i) => i.id !== id));
    }

    return (
        <main className={styles.main}>
            <header className={styles.header}>
                <h1 className={styles.title}>식재료</h1>
            </header>

            <form
                className={styles.addForm}
                onSubmit={(e) => {
                    e.preventDefault();
                    handleAdd();
                }}
            >
                <input
                    className={styles.input}
                    type="text"
                    placeholder="식재료 이름"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-label="식재료 이름"
                />
                <button type="submit" className={styles.addBtn} disabled={!name.trim() || adding}>
                    추가
                </button>
            </form>

            {!loadingItems && items.length === 0 ? (
                <p className={styles.empty}>등록된 식재료가 없습니다</p>
            ) : (
                <ul className={styles.list}>
                    {items.map((item) => (
                        <li key={item.id} className={styles.item}>
                            <span className={styles.itemName}>{item.name}</span>
                            <button
                                type="button"
                                className={styles.deleteBtn}
                                onClick={() => handleDelete(item.id)}
                                aria-label={`${item.name} 삭제`}
                            >
                                ×
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <BottomNav active="ingredients" />
        </main>
    );
}
