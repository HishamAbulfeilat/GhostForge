import { expect, test } from '@playwright/test'

test.describe('Critical browser smoke coverage', () => {
  test('login screen is interactive across mobile/tablet/desktop viewports', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'GhostForge' })).toBeVisible()

    await page.getByRole('button', { name: 'Use PIN instead' }).click()
    await expect(page.getByLabel('PIN')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use username & password instead' })).toBeVisible()
  })

  test('Arabic RTL direction keeps login flow readable without overflow', async ({ page }) => {
    await page.goto('/login')
    await page.locator('html').evaluate(el => {
      el.setAttribute('dir', 'rtl')
      el.setAttribute('lang', 'ar')
    })

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { name: 'GhostForge' })).toBeVisible()
    const horizontalOverflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth)
    expect(horizontalOverflow).toBeFalsy()
  })
})
